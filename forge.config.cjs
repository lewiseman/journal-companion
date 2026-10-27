const QvacForgePlugin = require('@qvac/sdk/electron-forge');

module.exports = {
  packagerConfig: {
    name: 'Journal Companion',
    executableName: 'Journal Companion',
    appBundleId: 'io.journal.companion',
    appCategoryType: 'public.app-category.productivity',
    osxSign: false,
    ignore: [/^\/test($|\/)/, /^\/docs($|\/)/, /^\/scripts($|\/)/, /^\/evidence-local($|\/)/, /^\/\.env(?:\.|$)/],
  },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [new QvacForgePlugin({ logLevel: 'info' })],
};
