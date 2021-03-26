import Promise from 'bluebird';
import md5 from 'md5';
import url from 'url'
import _ from 'lodash';
const debug = require('debug')('oada-cache-overmind:actions');
var namespace = null;
debug('oada-cache-overmind Running...')

//TODO: Completely do away with plural requests array syntax...

let syncs = {};
function ns(context) {
  return _.mapValues(context, (obj) => {
    if (namespace == null) return obj;
    return _.get(obj, namespace);
  })
}

function urlToConnectionId(domainUrl) {
  let domain = url.parse(domainUrl).hostname;
  return domain.replace(/\./g, '_')
}
function findSyncMatches(string) {
  return Object.keys(syncs).filter(key => string.startsWith(key))
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

module.exports = {
  actions: function(_namespace) {
    namespace = _namespace;
    return {
      connect(context, props) {
        const {state, effects} = ns(context);
        const connectionId = (props.connection_id || urlToConnectionId(props.domain))
        return effects.connect({
          connection_id: connectionId,
          domain:      props.domain,
          options:     props.options,
          cache:       props.cache,
          token:       props.token,
          websocket: props.websocket,
        }).then( (response) => {
          if (!state.defaultConn) state.defaultConn = connectionId;
          if (state[connectionId] == null) state[connectionId] = {};
          state[connectionId].token = response._token;
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
        //Loop through all changes in the response
        /*
        No need for this as long as oada effects are now @oada/client rather than oada-cache
        const changes = _.get(props, 'response.change') || [];
        if (!_.isArray(changes)) {
          console.warn('oada-cache-overmind: Watch response received from oada server was in a unrecognized format.', props);
          debug('WARNING: response.change not an array')
          return;
        }
        const watchPath = (props.path && props.path.length > 0) ? `${props.connection_id}.${props.path}` : props.connection_id;
        _.forEach(changes, (change) => {
        */
          let connection_id = props.connection_id || state.defaultConn;
          let watchPath = props.payload.watchPath || '';
          watchPath = watchPath.replace(/\/$/, '')
          watchPath = watchPath.replace(/^\//, '')
          watchPath = watchPath ? `.${watchPath}` : watchPath;
          let path = props.path.replace(/^\//, '');
          path = path.replace(/\/$/, '');
          path = props.path.split('/').join('.');
          const currentState = _.get(state, `${connection_id}${watchPath}${path}`)
          if (props.type == 'merge') {
            //Get the currentState at the change path
//            const changePath = props.path.split('/').join('.')
 //           const currentState = _.get(state, `${props.watchPath}${changePath}`);
            //Merge in changes
            _.merge(currentState, props.body);
          } else if (props.type == 'delete') {
            //Get the currentState at the change path
         //   const changePath = props.path.split('/').join('.')
         //   const currentState = _.get(state, `${connection_id}.${changePath}`);
            //Delete every leaf node in change body that is null, merge in all others (_rev, etc.)
            let parentPath = props.watchPath.replace(/^\//, '').split('/').join('.');
            handleDelete(currentState, props.body, parentPath);
          } else {
            console.warn('oada-cache-overmind: Unrecognized change type', props.type);
            debug('WARNING: Unrecognized change type', props.type)
          }
//        })
      },
      get(context, props) {
        const {state, effects, actions} = ns(context);
        var hasRequests = props.requests ? true : false;
        var requests = props.requests || [props];
        const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
        return PromiseMap(requests, (request, i) => {
          if (request.complete) return
          let _statePath = request.path.replace(/^\//, '').split('/').join('.')
          let connection_id = request.connection_id || props.connection_id || state.defaultConn;
          if (request.watch) {
            let conn = state[connection_id];
            if (conn) {
              if (conn && conn.watches && conn.watches[request.path]) return
              request.watch.actions = [actions.handleWatch, ...(request.watch.actions || [])];
              request.watch.payload = request.watch.payload || {};
              request.watch.payload.connection_id = connection_id;
              request.watch.payload.watchPath = _statePath;
            }
          }
          return effects.get({
            connection_id,
            url: request.url,
            path: request.path,
            headers: request.headers,
            watch: request.watch,
            tree: request.tree || props.tree,
          }).then((response) => {
            let _responseData = response.data;
            //Build out path one object at a time.
            var path = `${connection_id}.${_statePath}`;
            //Set response
            if (_responseData) _.set(state, path, _responseData);
            if (request.watch) {
              path = `${connection_id}.watches.${request.path}`;
              _.set(state, path, true);
            }
            requests[i].complete = true;
            return response;
          }).catch((error) => {
            return {error, ...error.response}
          })
        }).then((responses) => {
          return hasRequests ? {responses, requests} : responses[0];
        })
      },
      head(context, props) {
        const {state, effects, actions} = ns(context);
        var hasRequests = props.requests ? true : false;
        var requests = props.requests || [props];
        const PromiseMap = (props.concurrent) ? Promise.map : Promise.mapSeries;
        return PromiseMap(requests, (request, i) => {
          if (request.complete) return
          let _statePath = request.path.replace(/^\//, '').split('/').join('.')
          return effects.head({
            connection_id: request.connection_id || props.connection_id || state.defaultConn,
            url: request.url,
            path: request.path,
            headers: request.headers,
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
          return hasRequests ? {responses, requests} : responses[0];
        })
      },
      put(context, props) {
        const {state, effects, actions} = ns(context);
        var hasRequests = props.requests ? true : false;
        var requests = props.requests || [props];
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
            connection_id: request.connection_id || props.connection_id || state.defaultConn,
          }).then((response) => {
            /*
            var path = `${request.connection_id || props.connection_id}${request.path.split("/").join(".")}`;
            var oldState = _.cloneDeep(_.get(state, path));
            var newState = _.merge(oldState, request.data);
            // Optimistic update
            _.set(state, path, newState)
            */
            requests[i].complete = true;
            return response;
          });
        }).then((responses) => {
          return hasRequests ? {responses, requests} : responses[0];
        });
      },
      post(context, props) {
        const {state, effects, actions} = ns(context);
        var hasRequests = props.requests ? true : false;
        var requests = props.requests || [props];
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
              connection_id: request.connection_id || props.connection_id || state.defaultConn,
            })
            .then((response) => {
              /*
              var id = response.headers.location; //TODO why is this here?
              var path = `${request.connection_id || props.connection_id}${request.path.split("/").join(".")}`;
              var oldState = _.cloneDeep(_.get(state, path));
              var newState = _.merge(oldState, request.data);
              _.set(state, path, newState)
              */
              requests[i].complete = true;
              return;
            });
        }).then((responses) => {
          return hasRequests ? {responses, requests} : responses[0];
        });
      },
      delete(context, props) {
        const {state, effects, actions} = ns(context);
        var hasRequests = props.requests ? true : false;
        var requests = props.requests || [props];
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
              connection_id: request.connection_id || props.connection_id || state.defaultConn,
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
            } /*else {
              
              _.unset(state,`${connectionId}.${_statePath}`);
            }*/
            requests[i].complete = true;
            return response;
          });
        }).then((responses) => {
          return hasRequests ? {responses, requests} : responses[0];
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
          connection_id: props.connection_id || urlToConnectionId(props.domain)
        });
      },
      ensurePath(context, props) {
        const {state, actions, effects} = ns(context);
        let {connection_id, ensure, path, tree, watch } = props;
        return effects.head({
          path,
          tree,
          connection_id,
        }).catch(err => {
          if (err.status === 404) return effects.put({
            tree,
            connection_id,
            path,
            data: {},
          })
        })
      },
      async sync(context, props) {
        let {connection_id, ensure, path, tree } = props;
        const {state, actions, effects} = ns(context);
        let requests = [{
          connection_id,
          path,
          tree,
          watch: {
            actions: props.actions || [],
          },
        }];
        if (ensure !== false) await actions.ensurePath(_.clone(props));
        let re = await actions.get({requests})
        // register the sync with the handleSyncs function commenced on initialization of overmind
        let p = 'oada.'+connection_id+'.'+(path).replace(/^\//, '').replace(/\/$/,'').split('/').join('.');
        requests[0].path = p;
        syncs[p] = requests[0];
        debug(`sync set on path ${p}`)
        return requests[0]
      },
      killSync(context, {}) {
        const {state, actions, effects} = ns(context);
  //      unwatch,
      },
      test(context, {}) {
        const {state, effects} = ns(context);
      }
    }
  },
  onInitialize: function(context, overmind) {
    let {state, actions, effects} = ns(context);
    function handleSyncs(mutation) {
      if (!/^oada/.test(mutation.path)) return
      //Find sync entries in which the path matches the mutation path
      let keys = findSyncMatches(mutation.path);
      // sync matches to oada
      keys.forEach(async (key) => {
        console.log('Sync match: ', key);
        console.log('Mutation: ', mutation)
        if (mutation.method === "set") {
          console.log('Send put request:', {
            connection_id: syncs[key].connection_id,
            tree: syncs[key].tree,
            data: mutation.args[0],
            path: '/' + mutation.path.split('.').slice(2).join('/')
          });
          // TODO: Handle errors here regarding the optimistic update mutation that caused this.
          await actions.put({requests: [{
            connection_id: syncs[key].connection_id,
            tree: syncs[key].tree,
            data: mutation.args[0],
            path: '/' + mutation.path.split('.').slice(2).join('/')
          }]})
        } else if (mutation.method === 'unset') {
          console.log('Send delete request:', {
            connection_id: syncs[key].connection_id,
            tree: syncs[key].tree,
            path: '/' + mutation.path.split('.').slice(2).join('/')
          });
          // TODO: Handle errors here regarding the optimistic update mutation that caused this.
          await actions.delete({requests: [{
            connection_id: syncs[key].connection_id,
            tree: syncs[key].tree,
            path: '/' + mutation.path.split('.').slice(2).join('/')
          }]})
        }
      })
    }


    overmind.addMutationListener(handleSyncs)

  },
}
