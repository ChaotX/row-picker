// row-picker's own site (chaotx.github.io/row-picker). An app built on row-picker has a file like this with its
// own values; see js/settings.js for every option.
//
// The Google values are public (they end up in the browser anyway); protect them by restricting the OAuth client
// and the API key to your GitHub Pages origin. See README.md → "Google Cloud setup".
export default {
    name: 'row-picker',
    storagePrefix: 'row-picker',
    linksTitle: 'row-picker links',
    google: {
        clientId: '136817057087-26jlqfkmptubg04r16eph1pl630u10nd.apps.googleusercontent.com',
        apiKey: 'AIzaSyACuO7wMIbS_PCNqZm6Vqm5LYAKT-TNips',   // Drive Picker, and reading link-shared sheets without sign-in
        appId: '136817057087'                                 // Cloud project number, for the Drive Picker
    }
};
