import _TOKEN from './token'
let oada = require('@oada/client');
import uuid from 'uuid';
var connections = {};

const getConnection = function getConnection(connection_id) {
  return connections[connection_id];
}

const connect = async function connect(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  if (args.connection_id && connections[args.connection_id]) return Promise.resolve(connections[args.connection_id]);
  let _token = new _TOKEN(args);
  args.token = await _token.get();

  return oada.connect(args).then((conn) => {
    connections[args.connection_id] = conn;
    return conn;
  })
}

const head = function head(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  return connections[args.connection_id].head(args);
}

const get = function get(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  if (args.watch && args.watch.actions) {
    let actions = args.watch.actions;
    args.watchCallback = (payload) => {
      actions.forEach((action) => {
        payload.payload = args.watch.payload;
        action(payload)
      })
    }
  }
  return connections[args.connection_id].get(args);
}

const put = function put(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  return connections[args.connection_id].put(args);
}

const post = function post(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  return connections[args.connection_id].post(args);
}


const _delete = function _delete(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  return connections[args.connection_id].delete(args);
}


const disconnect = function _disconnect(args) {
  if (!args.connection_id) throw 'connection_id not supplied'
  var connection = connections[args.connection_id];
  connections[args.connection_id] = undefined;
  return connection.disconnect();
}

const resetCache = function resetCache(args) {
  //Currently oada-cache resets all of the cache, not just the db for a single connection_id
  return connections[args.connection_id].resetCache(args);
}

export default {
  connect,
  get,
  put,
  post,
  head,
  delete: _delete,
  resetCache,
  disconnect,
  getConnection,
};
