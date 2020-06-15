import Promise from 'bluebird';
import url from 'url'
import _ from 'lodash';
const debug = require('debug')('oada-cache-overmind:actions');
var namespace = null;
debug('oada-cache-overmind Running...')
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

function handleDelete(target, toRemove, parentPath) {
  //Remove any null leaf nodes, set values of any non-null nodes
  _.forEach(toRemove, (value, key) => {
    const setPath = parentPath ? `${parentPath}.${key}` : key;
    if (value == null) {
      _.unset(target, setPath)
    } else if (_.isObject(value)) {
      const newParentPath = parentPath == null ? key : `${parentPath}.${key}`;
      handleDelete(target, value, newParentPath);
    } else {
      _.set(target, setPath, value);
    }
  });
}

export default function(_namespace) {
  namespace = _namespace;
  return {
    connect(context, props) {
      const {state, effects} = ns(context);
      const connectionId = (props.connection_id || domainToConnectionId(props.domain))
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
        return {token: response.token, connectionId};
      }).catch((error) => {
        state.error = {error: error.message};
        state.isAuthenticated = false;
        return {error}
      });
    },
    handleWatch(context, props) {
      const {state, effects} = ns(context);
      debug('handleWatch', props);
      //Loop through all changes in the response
      const changes = _.get(props, 'response.change') || [];
      if (!_.isArray(changes)) {
        console.warn('oada-cache-overmind: Watch response received from oada server was in a unrecognized format.', props);
        debug('WARNING: response.change not an array')
        return;
      }
      const watchPath = (props.path && props.path.length > 0) ? `${props.connection_id}.${props.path}` : props.connection_id;
      _.forEach(changes, (change) => {
        if (change.type == 'merge') {
          //Get the currentState at the change path
          const changePath = change.path.split('/').join('.')
          const currentState = _.get(state, `${watchPath}${changePath}`);
          //Merge in changes
          _.merge(currentState, change.body);
        } else if (change.type == 'delete') {
          //Get the currentState at the change path
          const changePath = change.path.split('/').join('.')
          const currentState = _.get(state, `${watchPath}${changePath}`);
          //Delete every leaf node in change body that is null, merge in all others (_rev, etc.)
          handleDelete(currentState, change.body);
        } else {
          console.warn('oada-cache-overmind: Unrecognized change type', change.type);
          debug('WARNING: Unrecognized change type', change.type)
        }
      })
    },
    get(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error('Missing requests. Please pass requests in as an array of request objects under the requests key')
      var requests = props.requests || [];
      const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
      return PromiseMap(requests, (request, i) => {
        if (request.complete) return
        let _statePath = request.path.replace(/^\//, '').split('/').join('.')
        if (request.watch) {
          let conn = state[(request.connection_id || props.connection_id)];
          if (conn) {
            if (conn && conn.watches && conn.watches[request.path]) return
            request.watch.actions = [actions.handleWatch, ...request.watch.actions];
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
          }
          requests[i].complete = true;
          return response;
        }).catch((error) => {
          return {error, ...error.response}
        })
      }).then((responses) => {
        return {responses, requests}
      })
    },
    put(context, props) {
      const {state, effects, actions} = ns(context);
      if (!props.requests) throw new Error("Missing requests. Please pass requests in as an array of request objects under the requests key");
      var requests = props.requests || [];
      const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
      return PromiseMap(requests, (request, i) => {
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
          var path = `${request.connection_id || props.connection_id}${request.path.split("/").join(".")}`;
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
      const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
      return PromiseMap(requests, (request, i) => {
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
            var path = `${request.connection_id || props.connection_id}${request.path.split("/").join(".")}`;
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
      const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
      return PromiseMap(requests, (request, i) => {
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
      //Currently oada-cache resets all of the cache, not just the db for a single connection_id
      const {effects, state} = ns(context);
      //Connect if not connected
      return effects.resetCache({
        connection_id: props.connection_id || domainToConnectionId(props.domain)
      });
    }
  }
}
