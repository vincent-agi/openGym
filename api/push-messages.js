/**
 * The text of the social push notifications, per language.
 *
 * The recipient's language is the one their app is set to (`lang` in their synced state), read when
 * the push is sent. Every message is encouraging by design: no ranks, no comparisons, nothing that
 * says someone is behind. Each language must define every message (a test checks it); a language
 * that is not translated yet, or a missing entry, falls back to English rather than failing.
 *
 * To add a language: add its catalogue below (it is picked up automatically). Follow the tone of the
 * app's own translation for that language (formal "you" in French, informal in Spanish) and avoid
 * wording that depends on the recipient's gender.
 */

/** Placeholders: `{name}` a friend, `{n}` a number of friends, `{emoji}` a cheer, `{title}` a challenge. */
const CATALOG = {
  en: {
    friendSessionOne: { title: '{name} finished a session', body: 'Send a cheer 👏' },
    friendSessionMany: { title: '{n} friends trained today', body: 'Your crew is on a roll. Send a cheer 👏' },
    cheerReceived: { title: '{name} cheered your session {emoji}', body: 'Nice work 💪' },
    challengeInvite: { title: '{name} invited you to "{title}"', body: 'Join whenever you are ready.' },
    milestoneHalf: { title: 'Halfway there!', body: '"{title}" is half done. Keep it going.' },
    milestoneTarget: { title: 'Target reached 🎉', body: '"{title}": well played!' },
    challengeEnded: { title: '"{title}" is over', body: 'Thanks for taking part. See the results.' }
  },
  fr: {
    friendSessionOne: { title: '{name} a terminé une séance', body: 'Envoyez un encouragement 👏' },
    friendSessionMany: { title: '{n} amis se sont entraînés aujourd’hui', body: 'Votre équipe est en forme. Envoyez un encouragement 👏' },
    cheerReceived: { title: '{name} a encouragé votre séance {emoji}', body: 'Beau travail 💪' },
    challengeInvite: { title: '{name} vous invite à « {title} »', body: 'Rejoignez le défi quand vous voulez.' },
    milestoneHalf: { title: 'À mi-parcours !', body: '« {title} » est à moitié fait. Continuez.' },
    milestoneTarget: { title: 'Objectif atteint 🎉', body: '« {title} » : bien joué !' },
    challengeEnded: { title: '« {title} » est terminé', body: 'Merci d’avoir participé. Découvrez les résultats.' }
  },
  es: {
    friendSessionOne: { title: '{name} terminó una sesión', body: 'Envía un ánimo 👏' },
    friendSessionMany: { title: '{n} amigos entrenaron hoy', body: 'Tu equipo va en racha. Envía un ánimo 👏' },
    cheerReceived: { title: '{name} animó tu sesión {emoji}', body: 'Buen trabajo 💪' },
    challengeInvite: { title: '{name} te invita a «{title}»', body: 'Únete cuando quieras.' },
    milestoneHalf: { title: '¡A mitad de camino!', body: '«{title}» va por la mitad. ¡Sigue así!' },
    milestoneTarget: { title: 'Objetivo alcanzado 🎉', body: '«{title}»: ¡bien jugado!' },
    challengeEnded: { title: '«{title}» ha terminado', body: 'Gracias por participar. Mira los resultados.' }
  }
};

/** Languages the notifications are written in. */
export const PUSH_LANGS = Object.freeze(Object.keys(CATALOG));

/** Every message every language defines. */
export const MESSAGE_KEYS = Object.freeze(Object.keys(CATALOG.en));

/**
 * The supported language for whatever the app says: `fr-FR`, `FR_ca` and `fr` all give `fr`;
 * anything else, including a language not translated yet, gives English.
 *
 * @param {unknown} raw  The `lang` of the user's state.
 * @returns {string} One of {@link PUSH_LANGS}.
 */
export function normalizeLang(raw) {
  const code = typeof raw === 'string' ? raw.slice(0, 2).toLowerCase() : '';
  return PUSH_LANGS.includes(code) ? code : 'en';
}

/**
 * A message in a language, with its placeholders filled in.
 *
 * @param {unknown} lang  Language of the recipient; see {@link normalizeLang}.
 * @param {string} key    One of {@link MESSAGE_KEYS}.
 * @param {Record<string, string | number>} vars
 * @returns {{title: string, body: string}}
 * @throws {Error} For a key no language defines.
 */
export function pushText(lang, key, vars) {
  const entry = CATALOG[normalizeLang(lang)][key] || CATALOG.en[key];
  if (!entry) throw new Error(`unknown push message: ${key}`);
  const fill = text => text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
  return { title: fill(entry.title), body: fill(entry.body) };
}
