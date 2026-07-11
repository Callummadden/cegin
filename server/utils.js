// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
const net = require('net');

/**
 * Check whether an IP address belongs to a private/reserved range.
 * Used for SSRF protection before proxying external requests.
 */
function isPrivateIP(ip) {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;                         // 127.0.0.0/8
    if (parts[0] === 10) return true;                          // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;     // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;     // 169.254.0.0/16
    return false;
  }
  if (net.isIP(ip) === 6) {
    if (ip === '::1') return true;
    if (/^(fc|fd)/i.test(ip)) return true;   // fc00::/7
    if (/^fe80/i.test(ip)) return true;      // link-local
    return false;
  }
  return false;
}

module.exports = { isPrivateIP };
