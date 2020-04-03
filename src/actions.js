import Promise from 'bluebird';
import url from 'url'
import _ from 'lodash';

var namespace = null;
function ns(context) {
  return _.mapValues(context, (obj) => {
    return _.get(obj, namespace);
  })
}

function domainToConnectionId(domainUrl) {
  let domain = url.parse(domainUrl).hostname;
  return domain.replace(/\./g, '_')
}

export default function(_namespace) {
  namespace = _namespace;
  return {
    connect(context, props) {
      const {state, effects} = ns(context);
      const connectionId = (props.connection_id || domainToConnectionId(props.domain))
      console.log('effects2', effects)
      return effects.connect({
        connection_id: connectionId,
        domain:      props.domain,
        options:     props.options,
        cache:       props.cache,
        token:       props.token,
        websocket: props.websocket,
      }).then( (response) => {
        if (state[connectionId] == null) state[connectionId] = {};
        state[connectionId].token = response.token;
        state[connectionId].domain = props.domain;
        //Clear bookmarks if exist
        if (state[connectionId].bookmarks) state[connectionId].bookmarks = {};
        state.isAuthenticated = true;
      }).catch( (err) => {
        //TODO error handle? Return an error. Didn't in the cerebral version.
        state.error = {err};
        state.isAuthenticated = false;
      })
    },
    handleWatch(context, props) {
      const {state, effects} = ns(context);
      if (props.response.change.type === 'merge') {
        var oldState = _.cloneDeep(state.oada[props.connection_id][props.path]); //TODO namespace, error path not exist
        var newState = _.merge(oldState, props.response.change.body.data);
        state.oada[props.connection_id][props.path] = newState; //TODO namespace
        return {oldState}
      } else if (props.response.change.type === 'delete') {
        var nullPath = props.nullPath.split('/').join('.');
        var oldState = _.cloneDeep(state.oada[props.connection_id][nullPath]); //TODO namespace, error path not exist
        delete state.oada[props.connection_id][nullPath]
        return {oldState}
      }
    },
    get(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error('Missing requests. Please pass requests in as an array of request objects under the requests key')
      var requests = props.requests || [];
      return Promise.map(requests, (request, i) => {
        if (request.complete) return
        let _statePath = request.path.replace(/^\//, '').split('/').join('.')
        if (request.watch) {
          let conn = state.oada[(request.connection_id || props.connection_id)]; //TODO namespace
          if (!conn) {
            if (conn && conn.watches && conn.watches[request.path]) return
            request.watch.signals = [actions.oada.handleWatch, ...request.watch.actions]; //TODO namespace
            request.watch.payload = request.watch.payload || {};
            request.watch.payload.connection_id = request.connection_id || props.connection_id;
            request.watch.payload.path = _statePath;
          }
        }
        return effects.oada.get({ //TODO namespace
          connection_id: request.connection_id || props.connection_id,
          url: request.url,
          path: request.path,
          headers: request.headers,
          watch: request.watch,
          tree: request.tree || props.tree,
        }).then((response) => {
          let _responseData = response.data;
          //Build out path one object at a time.
          var path = `oada.${request.connection_id || props.connection_id}.${_statePath}`; //TODO namespace
          //Set response
          if (_responseData) _.set(state, path, _responseData);
          if (request.watch) {
            path = `oada.${request.connection_id || props.connection_id}.watches.${request.path}`; //TODO namespace
            _.set(state, path, true);
            store.set(state`${path}`, true)
          }
          requests[i].complete = true;
          return response;
        }).catch((err) => {
          //TODO handle error? Return error. Cerebral version does not.
          console.log('Error in oada.get', err);
          return err;
        })
      }).then((responses) => {
        return {responses, requests}
      })
    },
    disconnect(context, props) {
      const {state, effects} = ns(context);
      return effects.oada.disconnect({connection_id: props.connection_id}); //TODO namespace
    },
    test(context, props) {
      const {state} = ns(context);
      state.cyrus = true
    }
  }
}
