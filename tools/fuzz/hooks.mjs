// tools/fuzz/hooks.mjs — module resolution for the fuzzer: the Firebase CDN and
// the (gitignored) firebaseConfig.js resolve to local test doubles.
const HERE = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
    if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) {
        return { url: new URL('fake-firebase.mjs', HERE).href, shortCircuit: true };
    }
    if (/(^|\/)firebaseConfig\.js$/.test(specifier)) {
        return { url: new URL('fake-config.mjs', HERE).href, shortCircuit: true };
    }
    return next(specifier, context);
}
