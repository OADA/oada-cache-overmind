import Promise from 'bluebird';
import url from 'url'
import _ from 'lodash';

var namespace = null;
function ns(context) {
  return _.mapValues(context, (obj) => {
    if (namespace == null) return obj;
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
          let conn = state[(request.connection_id || props.connection_id)];
          if (!conn) {
            if (conn && conn.watches && conn.watches[request.path]) return
            request.watch.signals = [actions.handleWatch, ...request.watch.actions];
            request.watch.payload = request.watch.payload || {};
            request.watch.payload.connection_id = request.connection_id || props.connection_id;
            request.watch.payload.path = _statePath;
          }
        }
        return effects.get({
          connection_id: request.connection_id || props.connection_id,
          url: request.url,
          path: request.path,
          headers: request.headers,
          watch: request.watch,
          tree: request.tree || props.tree,
        }).then((response) => {
          let _responseData = response.data;
          //Build out path one object at a time.
          var path = `${request.connection_id || props.connection_id}.${_statePath}`;
          //Set response
          if (_responseData) _.set(state, path, _responseData);
          if (request.watch) {
            path = `${request.connection_id || props.connection_id}.watches.${request.path}`;
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
    put(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error("Missing requests. Please pass requests in as an array of request objects under the requests key");
      var requests = props.requests || [];
      return Promise.map(requests, (request, i) => {
        if (request.complete) return;
        return effects.put({
          url: request.url, //props.domain + ((request.path[0] === '/') ? '':'/') + request.path,
          path: request.path,
          data: request.data,
          type: request.type,
          headers: request.headers,
          tree: request.tree || props.tree,
          connection_id: request.connection_id || props.connection_id,
        }).then((response) => {
          var path = `${request.connection_id || props.connection_id}.${request.path.split("/").join(".")}`;
          var oldState = _.cloneDeep(_.get(state, path));
          var newState = _.merge(oldState, request.data);
          _.set(state, path, newState)
          requests[i].complete = true;
          return response;
        });
      }).then((responses) => {
        return { responses, requests };
      });
    },
    post(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error("Missing requests. Please pass requests in as an array of request objects under the requests key");
      var requests = props.requests || [];
      return Promise.map(requests, (request, i) => {
        if (request.complete) return;
        return effects.post({
            url: request.url, //props.domain + ((request.path[0] === '/') ? '':'/') + request.path,
            path: request.path,
            data: request.data,
            type: request.type,
            headers: request.headers,
            tree: request.tree || props.tree,
            connection_id: request.connection_id || props.connection_id,
          })
          .then((response) => {
            var id = response.headers.location; //TODO why is this here?
            var path = `${request.connection_id || props.connection_id}.${request.path.split("/").join(".")}`;
            var oldState = _.cloneDeep(_.get(state, path));
            var newState = _.merge(oldState, request.data);
            _.set(state, path, newState)
            requests[i].complete = true;
            return;
          });
      }).then((responses) => {
        return { responses };
      });
    },
    delete(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error("Missing requests. Please pass requests in as an array of request objects under the requests key");
      var requests = props.requests || [];
      const connectionId =
      return Promise.map(requests, (request, i) => {
        if (request.complete) return;
        const connectionId = request.connection_id || props.connection_id;
        let _statePath = request.path.replace(/^\//, "").split("/").join(".");
        let conn = _.get(state, connectionId);
        if (request.unwatch && conn && conn.watches) {
          // Don't send the unwatch request if it isn't being watched already.
          if (!conn.watches[request.path]) return;
        }
        return effects.delete({
            connection_id: connectionId,
            url: request.url,
            path: request.path,
            headers: request.headers,
            unwatch: request.unwatch,
            type: request.type,
            tree: request.tree || props.tree,
        })
        .then((response) => {
          //Handle watches index and optimistically update
          if (request.unwatch && conn && conn.watches) {
            _.unset(state,`${connectionId}.watches.${request.path}`);
          } else {
            _.unset(state,`${connectionId}.${_statePath}`);
          }
          requests[i].complete = true;
          return response;
        });
      }).then((responses) => {
        return { responses, requests };
      });
    },
    disconnect(context, props) {
      const {state, effects} = ns(context);
      return effects.disconnect({connection_id: props.connection_id});
    },
    resetCache(context, props) {
      return effects.resetCache({
        connection_id: props.connection_id || domainToConnectionId(props.domain)
      });
    },
    test(context, props) {
      const {state} = ns(context);
      state.cyrus = true
    }
  }
}
