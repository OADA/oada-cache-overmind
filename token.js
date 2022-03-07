"use strict";
/* Copyright 2018 Open Ag Data Alliance
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author Servio Palacios, Samuel Noel
 * Token API for Handling Tokens in the Cache Library - Super Class.
 * @module src/token
 */

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

var _Promise = require("bluebird");

var PouchDB = require("pouchdb");

if (PouchDB.default) PouchDB = PouchDB.default;

var {
  STATUS_CODE
} = require("http");

var urlLib = require("url");

var _ = require("lodash"); //const debug = require("debug")("oada-cache:token");


var crypto = require("crypto");

var oadaIdClient = require("@oada/oada-id-client");

var error = require('debug')('oada-cache-overmind:token:error');

var info = require('debug')('oada-cache-overmind:token:info');

var trace = require('debug')('oada-cache-overmind:token:trace');

class Token {
  constructor() {
    var param = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    var self = this;
    self._token = param.token || null;
    self._domain = param.domain || "localhost";
    self._options = param.options;
    self._dbprefix = param.dbprefix || "";
    trace('constructor: domain = ', self._domain, ', dbprefix = ', self._dbprefix); // creating database name based on the domain
    // ensured one to one correspondence with the domain
    // i.e., token belongs to that domain

    var hash = crypto.createHash("sha256");
    hash.update(self._domain);
    self._name = self._dbprefix + hash.digest("hex");
    trace('Token DB name is: ', self._name);
    self._isSet = self._token ? true : false;
    self._tokenDB = new PouchDB(self._name);
    self._id = "OadaTokenID";
    self._rev = null;
    self.token = self._token ? self._token : "";
    trace('constructor: self.token = ', self.token);
  } //constructor

  /**
   * searches for a local db and a doc
   */


  checkTokenDB() {
    var _this = this;

    return _asyncToGenerator(function* () {
      var result = null;

      try {
        //getting the doc from the server if exists
        var doc = yield _this._tokenDB.get(_this._id);
        trace('checkTokenDB: received doc ', doc);
        result = doc.token;
        _this._rev = doc._rev;
      } catch (err) {
        error('ERROR: failed to tokenDB.get(' + _this._id + ').  Error was: ', err);
        return result;
      }

      return result;
    })();
  } //checkTokenDB

  /**
   * if token was provided then it sets the .token in the constructor -> returns that value
   * sets the pouch db if it does not exist
   */


  setup(_expired) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      // Get a token
      var TOKEN = null; //returned to the chache library

      if (_this2.isSet()) {
        trace('setup: token is already set on self, using that: ', _this2.token);
        TOKEN = _this2.token;
      } else {
        trace('setup: token is not set, checking tokenDB'); // get token from local cache

        TOKEN = yield _this2.checkTokenDB();

        if (!TOKEN || _expired) {
          //local cache does not have a token
          var urlObj = urlLib.parse(_this2._domain);
          var result; // Open the browser and the login popup

          if (typeof window === "undefined") {
            result = yield oadaIdClient.node(urlObj.host, _this2._options);
          } else {
            // the library itself detects a browser environment and delivers .browser
            var gat = _Promise.promisify(oadaIdClient.getAccessToken);

            result = yield gat(urlObj.host, _this2._options);
          }

          TOKEN = result.access_token; //        debug("setup token -> access token:", result.access_token);

          _this2.put(TOKEN);
        } //if !TOKEN

      } //else


      return TOKEN;
    })();
  } //setup

  /**
   * fetches the token from the this._tokenDB or
   * setups the new database and retrieves the new token to be used
   */


  get() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      return _this3.setup();
    })();
  }
  /**
   * searches for the token in the this._tokenDB
   * if present, the it sends the current _rev
   * if not present (404), it creates a new document in the created this._tokenDB
   * @param {string} _token
   */


  put(_token) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      // get token from local cache
      var TOKEN = _this4.checkTokenDB();

      try {
        if (TOKEN) {
          //local cache has that token, use the _rev
          var response = yield _this4._tokenDB.put({
            _id: _this4._id,
            _rev: _this4._rev,
            token: _token
          });
          _this4.token = _token;
        } else {
          //not found
          //        debug("not found -> creating one");
          var _response = yield _this4._tokenDB.put({
            _id: _this4._id,
            token: _token
          });

          _this4.token = _token;
        } //else

      } catch (err) {//error("Error: not found -> put", err);
      }
    })();
  } //put


  renew() {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      _this5._isSet = false;
      return _this5.setup(true); //expired = true
    })();
  }

  cleanUp() {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      try {
        yield _this6._tokenDB.destroy(); //await this._tokenDB.close();

        _this6._isSet = false;
      } catch (err) {//error("deleting token from cache", err);
      }
    })();
  } //cleanUp


  isSet() {
    return this._isSet;
  }

} //class

/* exporting the module */


module.exports = Token;