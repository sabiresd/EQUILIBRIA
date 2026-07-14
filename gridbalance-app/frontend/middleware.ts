import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege TOUTES les routes sauf /login.
 *
 * L'authentification repose sur des cookies httpOnly poses par le backend :
 * le middleware ne peut donc pas lire le contenu du jeton (c'est voulu), il se
 * contente de verifier sa PRESENCE. La verification reelle (signature, role,
 * expiration) est faite par le backend a chaque appel — le middleware n'est
 * qu'un garde-fou de navigation, jamais une frontiere de securite.
 *
 * Le nom du cookie est configurable pour rester aligne avec le backend.
 */
const SESSION_COOKIE = process.env.AUTH_COOKIE_NAME ?? "gb_access";

/** Cookies acceptes en repli, pour tolerer les conventions usuelles. */
const FALLBACK_COOKIES = ["access_token", "session", "gb_session"];

const PUBLIC_PATHS = ["/login"];

function hasSession(req: NextRequest): boolean {
  if (req.cookies.has(SESSION_COOKIE)) return true;
  return FALLBACK_COOKIES.some((name) => req.cookies.has(name));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const authenticated = hasSession(req);

  // Deja connecte : /login renvoie vers le tableau de bord.
  if (isPublic && authenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isPublic) return NextResponse.next();

  // Non authentifie : on memorise la destination pour y revenir apres connexion.
  if (!authenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const target = `${pathname}${search}`;
    if (target && target !== "/") {
      url.searchParams.set("from", target);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Tout sauf : les fichiers statiques Next, les assets publics et le favicon.
   * (La racine "/" est incluse : elle redirige vers /dashboard.)
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
