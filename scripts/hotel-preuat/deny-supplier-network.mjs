// Reproducible test preload. Individual tests replace fetch with synthetic fixtures.
// No supplier request is permitted when a test forgets to install its mock.
import './loopback-only.cjs';
globalThis.fetch = async () => { throw new Error('Supplier network disabled during regression tests'); };
