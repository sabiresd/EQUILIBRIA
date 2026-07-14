/**
 * Serialisation CANONIQUE (JCS-like) d'une carte de decision.
 *
 * L'empreinte SHA-256 est calculee cote backend ; l'UI ne recalcule rien et ne
 * "prouve" rien par elle-meme — le bouton « Verifier l'integrite » interroge
 * /api/decisions/{id}/verify, seule autorite. Cette fonction sert UNIQUEMENT a
 * AFFICHER la representation canonique de maniere lisible et deterministe :
 *   - cles triees par ordre lexicographique, a tous les niveaux ;
 *   - tableaux preservant leur ordre (il est signifiant) ;
 *   - `undefined` omis.
 *
 * L'affichage est indente pour la lecture humaine ; la forme hachee cote backend
 * est la variante compacte (sans espaces).
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function sortValue(value: unknown): Json {
  if (value === null) return null;
  if (Array.isArray(value)) {
    // L'ordre des tableaux est signifiant (heures, actions) : on ne trie PAS.
    return value.map(sortValue);
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: { [key: string]: Json } = {};
    Object.keys(source)
      .filter((k) => source[k] !== undefined)
      .sort()
      .forEach((k) => {
        out[k] = sortValue(source[k]);
      });
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  // Fonctions, symboles, undefined : non representables en JSON.
  return null;
}

/** Version indentee, pour affichage. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

/** Version compacte : c'est cette forme que le backend hache. */
export function canonicalJsonCompact(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
