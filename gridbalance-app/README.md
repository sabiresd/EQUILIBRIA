# ⚡ GridBalance AI Morocco

**Orchestrateur de flexibilité réseau électrique pour les journées sans vent.**

Prévoit la production et la consommation sur **360 heures (15 jours)**, calcule le déficit des journées sans vent, propose **3 plans de rééquilibrage candidats sourcés par RAG**, et exige une **validation humaine (HITL)** avant toute « exécution ». Chaque décision validée est horodatée, hachée en SHA-256 et journalisée.

> ⚠️ **Prototype de simulation et d'aide à la décision. Non connecté aux systèmes de l'ONEE. Aucun équipement réel n'est piloté. Tarifs affichés à titre de démonstration, non officiels ANRE.**

---

## 🚀 Lancement en local

**Prérequis : Python 3.12 et Node 18+. Rien d'autre.** Pas de Docker, pas de MongoDB à installer, pas de serveur SMTP.

```powershell
.\start.ps1 -Install     # 1re fois : installe les dépendances et démarre tout
.\start.ps1              # ensuite : démarre simplement
```

Ou à la main, dans deux terminaux :

```bash
# Terminal 1 — backend
cp .env.example .env
pip install -r backend/requirements.txt
cd backend && PYTHONPATH=..:. python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

| Service | URL |
|---|---|
| 🖥️ Application | http://localhost:3000 |
| 📘 API (Swagger) | http://localhost:8000/docs |
| 📬 E-mails envoyés | `backend/outbox/*.html` — à ouvrir dans un navigateur |

Trois dépendances sont **neutralisées par défaut**, pour que le projet démarre sans rien installer :

| Dépendance | Mode par défaut | Conséquence |
|---|---|---|
| Les 4 agents | `WF_MODE=stub` | Simulés dans le backend, données réalistes et déterministes |
| MongoDB | `MONGO_URL=memory` | Base **en mémoire** — ⚠️ **les données sont perdues à l'arrêt du backend** |
| SMTP | `MAIL_MODE=file` | Les e-mails sont écrits dans `backend/outbox/` au lieu d'être envoyés |

Pour conserver vos données entre deux sessions, renseignez un vrai MongoDB dans `.env` — soit local (`mongodb://localhost:27017`), soit **Atlas** (`mongodb+srv://…`, gratuit, aucune installation).

### 👥 Comptes de démonstration

Affichés et cliquables sur la page de connexion. Mot de passe commun : **`demo1234`**.

| Compte | Rôle | Peut faire |
|---|---|---|
| `operator@demo.ma` | **operator** | Lancer des simulations, consulter les dashboards, **proposer** un plan |
| `supervisor@demo.ma` | **supervisor** | Tout ce qui précède + **valider / rejeter** les plans, acquitter les alertes |
| `admin@demo.ma` | **admin** | Tout + gestion des utilisateurs, configuration, purge et export du journal |

Le RBAC est appliqué **côté backend** (le masquage de l'UI n'est qu'un confort) : un `operator` qui appelle `POST /api/runs/{id}/validate` reçoit un **403**, quoi qu'il fasse dans le navigateur.

---

## 🎬 Scénario de démo — 5 minutes

**1. Connexion (30 s).** Ouvrez http://localhost:3000. Le disclaimer est en bannière. Cliquez sur la carte **`operator@demo.ma`** : le formulaire se pré-remplit. Connectez-vous.

**2. Lancer une journée sans vent (1 min).** Allez sur **Simulation**. Choisissez le scénario **« Sans vent »**, laissez les paramètres batterie par défaut (40 MWh, 10 MW, SoC min 10 %, rendement 92 %), lancez.

Le **stepper** montre WF-1 puis WF-2 passer de *en attente* à *terminé*, avec leur durée. Le **`correlation_id`** s'affiche : c'est le fil rouge qui suivra ce run jusqu'au journal d'audit.

**3. Constater le déficit (1 min).** Les 6 graphes se remplissent. Sur le graphe **vent**, la chute est nette : la vitesse s'effondre entre 2 et 4 m/s pendant ~120 heures, et la production éolienne tombe à **zéro**. La batterie se vide jusqu'à son plancher, puis stagne — plus rien ne la recharge. Le graphe **déficit** montre les heures que plus aucune source ne couvre.

> Comparez avec le scénario **« Normal »** : **0 MWh de déficit**, et un coût près de **2,3 fois inférieur**. C'est tout le sujet du produit.

**4. Générer les plans (1 min).** Allez sur **Plans**, cliquez **« Générer les plans »** (c'est WF-3, le seul workflow avec un LLM). Trois cartes apparaissent :

- **Plan A — moins-disant économique** : le moins cher, mais score d'équité faible (0,42).
- **Plan B — équité maximale** : rotation entre les sites, score 0,93.
- **Plan C — équilibre** : décalage de charge plutôt que coupure sèche.

Chaque plan affiche ses **citations RAG dépliables** (document, page, extrait). L'**hôpital** apparaît avec un **cadenas** : il n'est délesté dans aucun plan, jamais.

**5. Proposer, puis valider (1 min 30).** En tant qu'**operator**, vous ne pouvez que **proposer** : cliquez « Proposer » sur le **plan B**. Le bouton « Valider » n'existe pas pour vous.

Déconnectez-vous, reconnectez-vous en **`supervisor@demo.ma`**. Le plan proposé attend dans la file **« À valider »**. Tentez de valider **sans commentaire** : c'est refusé. Saisissez un motif (« Plan B retenu : meilleur score d'équité, hôpital préservé »), validez.

**6. Vérifier la traçabilité (1 min).** Vous arrivez sur **Décisions**. Ouvrez la carte : le **JSON canonique**, le **SHA-256**. Cliquez **« Vérifier l'intégrité »** → badge vert **intègre** (le hash est recalculé et comparé).

Puis :
- 📬 Ouvrez le dernier fichier de **`backend/outbox/`** dans un navigateur : le rapport HTML est là, avec les KPI, le plan validé et le hash.
- 🔔 Allez sur **Alertes** : le dépassement du seuil de déficit et la chute du SoC ont levé des alertes. Acquittez-les — le nom et l'horodatage sont tracés.
- 📖 Allez sur **Journal** : toute la séquence est là (connexion, lancement, génération, proposition, validation, journalisation), reliée par le même `correlation_id`.

---

## 🏗️ Architecture

```
Navigateur ──► Frontend Next.js ──► Backend FastAPI (BFF) ──► Plateforme agentique (4 agents)
                                          │
                                          ├──► MongoDB   (runs, décisions, alertes, audit)
                                          ├──► SMTP      (rapports, alertes)
                                          └──► Slack     (optionnel, via WF-4)
```

**Le navigateur n'appelle jamais la plateforme agentique directement.** Tout passe par le BFF, qui applique cette chaîne, dans cet ordre :

```
Auth Gate → JWT (access 15 min / refresh 7 j) → RBAC → rate limit (30 req/min/utilisateur)
          → validation Pydantic → injection du correlation_id → appel workflow
```

### Les 4 workflows

| Workflow | Rôle | LLM |
|---|---|---|
| **WF-1 Simulateur** | Météo Open-Meteo (vent, irradiance) → séries production éolienne/solaire + demande sur 360 h | — |
| **WF-2 Calcul** | Boucle 360 h : bilan production/demande, dispatch batterie (SoC min, P max, rendement, dégradation), déficits, coûts par période tarifaire | — |
| **WF-3 Plan** | Génère 3 plans candidats A/B/C avec citations sourcées. Renvoie `rag_fallback: true` + `human_validation_required: true` si la preuve est insuffisante | **Mistral + RAG Chroma** |
| **WF-4 Journal** | Journalise la décision dans MongoDB avec hash SHA-256, déclenche Slack + Gmail | — |

### 📐 Contrats

`contracts/` est la **source de vérité unique** : `schemas.json` (JSON Schema) fait foi, `contracts.py` (Pydantic, backend) et `contracts.ts` (Zod, frontend) en sont les deux projections. Toute évolution de contrat commence par `schemas.json`.

Un **`correlation_id` (UUID v4)** est généré au début de chaque run, propagé à travers les 4 workflows, affiché dans l'UI et présent sur **chaque message d'erreur** — c'est ce qu'on demande à l'utilisateur quand il appelle le support.

---

## 🔌 Brancher la plateforme agentique

Les 4 agents **vivent sur votre plateforme agentique** (ABA Fusion / Langflow) : ils ne sont pas hébergés par cette application. Le backend les appelle par **webhook POST**, et ne connaît rien d'autre que ce POST et le contrat de `contracts/schemas.json`. L'application est donc **agnostique de la plateforme**.

Par défaut `WF_MODE=stub` : les 4 agents sont simulés dans le backend, la démo tourne hors ligne. Pour appeler les vrais agents :

```dotenv
# .env
WF_MODE=live
WF1_URL=https://<votre-instance>/api/v1/webhook/<flow_id_simulateur>
WF2_URL=https://<votre-instance>/api/v1/webhook/<flow_id_calcul>
WF3_URL=https://<votre-instance>/api/v1/webhook/<flow_id_plan>
WF4_URL=https://<votre-instance>/api/v1/webhook/<flow_id_journal>
```
Puis redémarrez le backend.

Sur ABA Fusion, l'endpoint d'un agent est visible dans son nœud *Webhook* après import du flow. **Attention** : la plateforme régénère l'identifiant du flow à chaque import — si vous réimportez, relevez les nouveaux endpoints et mettez le `.env` à jour.

> ⚠️ **Le cas des plateformes asynchrones.** ABA Fusion / Langflow répond **`202 Accepted`** — « tâche lancée en arrière-plan » — **sans renvoyer le résultat dans la réponse HTTP**. Le contrat de `contracts/`, lui, est synchrone : il attend la réponse de l'agent.
>
> Le backend **détecte ce cas**, bascule sur les données simulées et **marque le run en mode dégradé** dans l'interface, plutôt que d'échouer silencieusement. La démo continue, mais soyez lucide : **les résultats affichés viennent alors des stubs, pas de vos agents.**
>
> Pour exploiter réellement une plateforme asynchrone, il faut que chaque agent **rappelle un webhook de callback** exposé par ce backend à la fin de son traitement. C'est une évolution d'architecture (un endpoint de réception + un run en attente), pas un réglage de configuration.

**Vérifier le branchement** : page **Admin → Configuration**, un bouton *« Tester la connexion »* par service (WF-1 à WF-4, MongoDB, SMTP) affiche le statut et la latence. Le dashboard montre les mêmes états en pastilles vert / orange / rouge.

---

## 🛡️ Robustesse

| Situation | Comportement |
|---|---|
| Agent lent | Timeout **60 s**, **2 retries** avec backoff exponentiel |
| Agent injoignable | Le run passe en erreur, une **alerte critique** est levée, l'UI l'indique clairement et propose de relancer |
| Agent asynchrone (202) | Bascule en **mode dégradé** signalé, la démo continue |
| Réponse hors contrat | Rejet explicite avec le nombre d'erreurs de validation |
| Erreur inattendue | Message propre + `correlation_id`. **Jamais de stack trace à l'écran** |

---

## 🧪 Tests

```bash
cd backend && python -m pytest -v      # chaîne auth + RBAC + hash des cartes de décision
cd frontend && npx playwright test     # login → simulation → validation → décision journalisée
```

Ce que les tests backend verrouillent, et pourquoi :

- **Auth** — un *refresh token* présenté comme *access token* est rejeté ; un token expiré est rejeté ; un token signé avec un mauvais secret est rejeté.
- **RBAC** — un `operator` **peut proposer mais ne peut pas valider**. C'est le cœur du HITL : si cette assertion tombe, la validation humaine ne vaut plus rien.
- **Hash** — le SHA-256 est **déterministe**, **indépendant de l'ordre des clés** (JSON canonique), et **change dès qu'un octet de la carte change**. Un test falsifie une carte et vérifie que l'altération est détectée.

---

## 📁 Structure

```
gridbalance-app/
├── contracts/            # source de vérité : schemas.json → contracts.py + contracts.ts
├── backend/              # FastAPI : auth, RBAC, orchestration, hash, alertes, e-mails
│   ├── app/core/         #   config, sécurité (JWT/RBAC/CSRF), base de données
│   ├── app/services/     #   workflows (client), stubs, orchestrateur, audit, mailer
│   ├── app/routers/      #   auth, runs, decisions, ops
│   └── tests/            #   auth + RBAC + hash
├── frontend/             # Next.js 14 (App Router), Tailwind, shadcn/ui, Recharts
│   └── e2e/              #   Playwright : le parcours de démo complet
├── start.ps1             # lance backend + frontend en local (Windows)
└── .env.example          # toutes les variables, documentées
```

---

## ⚙️ Configuration

Toutes les variables sont dans `.env.example`, documentées une par une. Les plus structurantes :

| Variable | Défaut | Rôle |
|---|---|---|
| `WF_MODE` | `stub` | `stub` = agents simulés en interne ; `live` = vrais webhooks |
| `MONGO_URL` | `memory` | `memory` = base en mémoire (non persistante) ; sinon une URI MongoDB |
| `MAIL_MODE` | `file` | `file` = e-mails écrits dans `backend/outbox/` ; `smtp` = envoi réel |
| `WF{1..4}_URL` | — | Les 4 endpoints webhook des agents |
| `WF_TIMEOUT_SECONDS` | `60` | Timeout par appel d'agent |
| `WF_RETRIES` | `2` | Nombre de tentatives supplémentaires |
| `JWT_SECRET` | — | **À changer impérativement hors démo** |
| `RATE_LIMIT_PER_MINUTE` | `30` | Par utilisateur authentifié, par IP sinon |
| `ALERT_DEFICIT_THRESHOLD_MW` | `1.5` | Calibré sur le site de démo (besoin 6-15 MW) |
| `ALERT_SOC_THRESHOLD` | `0.15` | Alerte quand l'état de charge passe sous 15 % |
| `OIDC_ENABLED` | `false` | Branchement OIDC prêt, désactivé par défaut |

---

## 📊 Données

Toutes les valeurs sont des **données de démonstration**. Les coûts sont en **MAD**. **Aucune donnée réelle ONEE ou ANRE** n'est utilisée, et les tarifs affichés n'ont **aucune valeur officielle**.

Les stubs sont **déterministes** (graine dérivée du `correlation_id`) : deux runs identiques produisent le même résultat, ce qui rend la démo reproductible et les tests stables.
