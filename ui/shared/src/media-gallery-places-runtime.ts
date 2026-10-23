/** Signed HTTPS Child transport wins over legacy direct-in-Gallery prototype.
 * Release denial inside the Child transport stays static, not prototype.
 */
export function xDriveBaiduPlacesRuntime(
  signedChildPorts: boolean, prototypePorts: boolean,
): 'isolated' | 'prototype' | 'static' {
  return signedChildPorts ? 'isolated' : prototypePorts ? 'prototype' : 'static'
}
