// Development launches must refresh the worker after qvac.config.json changes.
import('@qvac/sdk/commands').then(({ bundleSdk }) => bundleSdk({
  projectRoot: require('node:path').resolve(__dirname, '..'), hosts: ['darwin-arm64'], network: false,
})).catch((error) => { console.error(error.message); process.exitCode = 1; });
