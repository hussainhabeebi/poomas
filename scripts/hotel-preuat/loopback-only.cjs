// Required in every local preview Node process. No external network, including TLS.
const net = require('node:net');
const tls = require('node:tls');
function assertLocal(host) {
 if (host && !['127.0.0.1','localhost','::1','[::1]'].includes(String(host))) throw new Error('PREVIEW_EGRESS_BLOCKED');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
 const arg = Array.isArray(args[0]) ? args[0][0] : args[0];
 if (arg && typeof arg === 'object') {
  if (arg.path) throw new Error('PREVIEW_UNIX_SOCKET_BLOCKED');
  assertLocal(arg.host || arg.hostname);
 } else if (typeof arg === 'number') assertLocal(typeof args[1] === 'string' ? args[1] : undefined);
 else throw new Error('PREVIEW_CONNECTION_BLOCKED');
 return connect.apply(this,args);
};
const secureConnect = tls.connect;
tls.connect = function(...args) {
 const options = args.find(x=>x && typeof x === 'object');
 assertLocal(options?.host || (typeof args[1] === 'string' ? args[1] : undefined));
 return secureConnect.apply(this,args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input,init) {
 const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
 if (!['http:','https:'].includes(url.protocol)) throw new Error('PREVIEW_PROTOCOL_BLOCKED');
 assertLocal(url.hostname);
 return originalFetch(input,init);
};
