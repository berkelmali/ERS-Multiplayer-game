// tools/fuzz/hooks.mjs — module resolution for the fuzzer: the Firebase CDN and
// the (gitignored) firebaseConfig.js resolve to local test doubles. In the host
// mode the screen modules the multiplayer client imports on the fly (ui.js,
// victoryScreen.js) resolve to a recorder: the fuzzer tests what the host
// DOES, not how it draws it. Only those importers are redirected, so the
// offline engine keeps every real module it had.
//
// resolveSync is registered in-thread (module.registerHooks, Node >= 22.15):
// an import() then settles within one macrotask, so the fake clock never runs
// ahead of a pending import and a seed replays exactly. Off-thread hooks
// (module.register) take real, variable time per import().
const HERE = new URL('./', import.meta.url);
const SCREEN_IMPORTERS = /\/public\/js\/(multiplayerMode|firebaseSync)\.js(\?|$)/;
function redirect(specifier, parentURL) {
    if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) return new URL('fake-firebase.mjs', HERE).href;
    if (/(^|\/)firebaseConfig\.js$/.test(specifier)) return new URL('fake-config.mjs', HERE).href;
    if (parentURL && SCREEN_IMPORTERS.test(parentURL) && /^\.\/(ui|victoryScreen)\.js(\?.*)?$/.test(specifier)) return new URL('fake-screen.mjs', HERE).href;
    return null;
}
export function resolveSync(specifier, context, next) {
    const url = redirect(specifier, context.parentURL);
    return url ? { url, shortCircuit: true } : next(specifier, context);
}
export async function resolve(specifier, context, next) {
    const url = redirect(specifier, context.parentURL);
    return url ? { url, shortCircuit: true } : next(specifier, context);
}
