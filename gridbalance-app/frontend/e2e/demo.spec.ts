/**
 * Test end-to-end du parcours de démo complet :
 *   login operator → simulation sans vent → déficit visible → génération des plans
 *   → proposition du plan B → bascule superviseur → validation avec commentaire
 *   → carte de décision journalisée, hash SHA-256 vérifié.
 *
 * C'est exactement le scénario de démo du README. S'il passe, la démo passe.
 */
import { expect, test } from "@playwright/test";

const OPERATOR = { email: "operator@demo.ma", password: "demo1234" };
const SUPERVISOR = { email: "supervisor@demo.ma", password: "demo1234" };

async function login(page: import("@playwright/test").Page, user: typeof OPERATOR) {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(user.email);
  await page.getByLabel(/mot de passe/i).fill(user.password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function logout(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /déconnexion|se déconnecter/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
}

test.describe("Parcours de démo GridBalance", () => {
  test("le disclaimer est visible dès la page de connexion", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/non connecté aux systèmes de l'onee/i)).toBeVisible();
  });

  test("login → simulation → plans → validation → décision journalisée", async ({ page }) => {
    // --- 1. L'opérateur lance une simulation "sans vent"
    await login(page, OPERATOR);
    await page.goto("/simulation");

    await page.getByLabel(/scénario/i).selectOption("windless");
    await page.getByRole("button", { name: /lancer la simulation/i }).click();

    // Le correlation_id doit apparaître : c'est le fil rouge du run.
    const cidLocator = page.getByTestId("correlation-id");
    await expect(cidLocator).toBeVisible({ timeout: 15_000 });
    const correlationId = (await cidLocator.textContent())?.trim() ?? "";
    expect(correlationId).toMatch(/[0-9a-f-]{36}/);

    // --- 2. Le stepper montre WF-1 puis WF-2 terminés
    await expect(page.getByTestId("step-WF1")).toHaveAttribute("data-status", "done", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("step-WF2")).toHaveAttribute("data-status", "done", {
      timeout: 60_000,
    });

    // --- 3. Le déficit de la fenêtre sans vent est visible
    await expect(page.getByTestId("kpi-deficit")).toBeVisible();

    // --- 4. Génération des 3 plans candidats (WF-3, le seul avec LLM)
    await page.goto("/plans");
    await page.getByRole("button", { name: /générer les plans/i }).click();

    await expect(page.getByTestId("plan-A")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("plan-B")).toBeVisible();
    await expect(page.getByTestId("plan-C")).toBeVisible();

    // Les charges protégées sont verrouillées : l'hôpital n'est jamais délesté.
    await expect(page.getByTestId("protected-hopital")).toBeVisible();

    // --- 5. L'opérateur PROPOSE le plan B — il ne peut pas le valider lui-même.
    await page.getByTestId("propose-B").click();
    await expect(page.getByText(/proposé|en attente de validation/i)).toBeVisible();

    // Le bouton de validation n'existe pas pour un opérateur (RBAC côté UI).
    await expect(page.getByTestId("validate-B")).toHaveCount(0);

    await logout(page);

    // --- 6. Le superviseur valide, avec commentaire OBLIGATOIRE
    await login(page, SUPERVISOR);
    await page.goto("/plans");

    await expect(page.getByTestId("validation-queue")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("validate-B").click();

    // Valider sans commentaire doit être refusé.
    await page.getByRole("button", { name: /^valider$/i }).click();
    await expect(page.getByText(/commentaire.*obligatoire|requis/i)).toBeVisible();

    await page
      .getByLabel(/commentaire/i)
      .fill("Plan B retenu : meilleur score d'équité, hôpital préservé.");
    await page.getByRole("button", { name: /^valider$/i }).click();

    // --- 7. La carte de décision est journalisée et son intégrité vérifiable
    await expect(page).toHaveURL(/\/decisions/, { timeout: 30_000 });

    const row = page.getByTestId(`decision-${correlationId}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    await expect(page.getByTestId("decision-sha256")).toHaveText(/^[a-f0-9]{64}$/);

    await page.getByRole("button", { name: /vérifier l'intégrité/i }).click();
    await expect(page.getByTestId("integrity-badge")).toHaveText(/intègre/i, { timeout: 15_000 });
  });
});
