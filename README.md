# ⚡ EQUILIBRIA

![Logo EQUILIBRIA](EQUILIBRIA.jpg)

> Système multi-agents (Agentic AI) d'équilibrage du réseau électrique en situation de déficit d'énergies renouvelables.

---

## 📌 Présentation

**EQUILIBRIA** répond à une question simple et redoutable : *comment alimenter un site industriel pendant quinze jours sans vent ?*

Le 13 décembre 2025, la production éolienne française est tombée à **504 MW en moyenne, soit 0,9 % de la consommation nationale** — contre 10 à 15 % un jour ordinaire, avec un creux à 40 MW en milieu de journée. Ce jour-là, un site équipé de panneaux solaires et d'éoliennes ne produit quasiment rien, sa batterie se vide sans jamais se recharger, et le réseau — plafonné par la puissance souscrite — ne suffit plus à combler l'écart.

EQUILIBRIA orchestre **quatre agents spécialisés** qui collectent l'état du réseau, arbitrent heure par heure entre production, stockage et achat, puis décident d'un délestage **équitable et justifié** lorsque plus aucune source ne peut couvrir la demande. Chaque décision est horodatée, tracée et mesurée.

Le système est conçu pour **dégrader proprement** : API de données injoignable, corpus RAG indisponible, base de données en échec — chaque panne a son chemin de repli, et le repli est journalisé comme tel.

---

## 🏗️ Architecture détaillée

Quatre agents autonomes, communiquant **de façon asynchrone via des Webhooks A2A** (*Agent-to-Agent*). Chaque message est une enveloppe JSON structurée et validée (**Pydantic**) :

```json
{
  "from": "agent_simulateur",
  "action": "etat_reseau",
  "payload": { "...": "..." }
}
```

Chaque agent expose un **Agent Card** (`agent_cards/`) décrivant son endpoint, ses compétences, ses schémas d'entrée/sortie et ses dépendances — ce qui permet la découverte dynamique (`discover`) avant toute délégation (`delegate`).

### 1️⃣ Agent Simulateur / Collecte 🛰️

Point d'entrée du système, déclenché par webhook ou par planification.

- Interroge l'**API ODRE / eco2mix** (RTE) : consommation, éolien, solaire, thermique, nucléaire, hydraulique, taux de CO₂.
- Structure la réponse en un objet **`EtatReseau`** validé par Pydantic, sur un horizon de **360 heures (15 jours)**.
- **Repli automatique** : si l'API est indisponible, l'agent bascule sur un **dataset figé du 13/12/2025** — un jour sans vent *réel*, pas une simulation — et positionne `fallback: true` dans son message.
- Transmet l'état du réseau à l'Agent de Calcul.

> 💡 Le repli n'est pas un pis-aller : il garantit que la chaîne complète reste démontrable et reproductible, même hors ligne.

### 2️⃣ Agent de Calcul ⚙️

Le cœur de l'optimisation. Il déroule un arbitrage **heure par heure sur 360 heures**.

Pour chaque heure, dans cet ordre :

1. **Production directe** — coût minimal ; l'éventuel surplus recharge la batterie.
2. **Décharge batterie** — uniquement si le coût d'usure/amortissement est inférieur au tarif horaire du réseau **et** si l'état de charge le permet.
3. **Achat au réseau** — au tarif horaire ANRE de l'heure.

La batterie est modélisée comme un **stock, pas comme une source infinie** : capacité 40 MWh, état de charge initial 20 MWh, puissance limitée à 10 MW, rendement 0,92, recharge par le seul surplus de production. L'état de charge (`soc_mwh`) est suivi heure par heure, et un contrôle de bornes interdit tout plan violant les contraintes physiques.

La **puissance souscrite au réseau est plafonnée** : au-delà, l'énergie manquante devient du **déficit résiduel**.

- ✅ Déficit nul → le plan part directement à l'Agent Journal (`EQUILIBRE_OK`).
- ⚠️ Déficit résiduel → l'Agent Plan de Rééquilibrage est sollicité (`DEFICIT_RESIDUEL`).

### 3️⃣ Agent Plan de Rééquilibrage 🧠 *(RAG + LLM)*

N'intervient **que si un déficit résiduel subsiste**. C'est l'agent qui décide qui est délesté — donc celui qui doit se justifier.

- **Recherche RAG** dans un corpus de règles : priorités de charge, règles d'équité, plafonds de coupure, historique des sites déjà pénalisés.
- **Raisonnement LLM (Mistral)** pour choisir les actions de délestage, sous deux garde-fous non négociables :
  - 🏥 **L'hôpital n'est jamais coupé.** Site `Critical_Infra`, priorité verrouillée.
  - ⚖️ **Rotation équitable** : un site déjà délesté sur 24 h glissantes est exclu du tour suivant.
- **Justification sourcée** : chaque action cite le passage du corpus qui la fonde.
- 🔍 **Boucle d'auto-vérification (*faithfulness*)** : l'agent relit son propre plan et vérifie que chaque justification est réellement soutenue par une source citée. En cas d'échec, il **reformule sa requête RAG une seule fois**, puis produit son plan définitif.
- **Repli** : si le corpus est injoignable, un jeu de règles de secours embarqué prend le relais, et le plan est marqué `rag_fallback: true` — la dégradation est explicite, jamais silencieuse.

### 4️⃣ Agent Journal & Dashboard 📊

Garant de la traçabilité et de la mesure.

- **Horodatage serveur anti-falsification** : la date est apposée côté serveur, jamais fournie par l'appelant.
- **Persistance MongoDB Atlas** dans la collection `journal_decisions`, avec **mécanisme de retry (×3, backoff exponentiel)** puis écriture locale de secours en dernier ressort.
- **Agrégation des métriques** :
  - 🔋 *Énergie* — coût total, part batterie / réseau / production, heures en déficit.
  - 🧾 *RAG* — taux de citation, score de faithfulness, taux de fallback.
- **Rapport et tableau de bord sur 15 jours.**

---

## 🛠️ Technologies

| Domaine | Technologie |
|---|---|
| 🤖 Plateforme agentique | **ABA Fusion Agentic AI** |
| 🧠 Raisonnement & décision | **Mistral AI** (`codestral`), **Google Gemini** (`gemini-2.5-flash`) |
| 📐 Structuration des données | **Pydantic** — schémas `EtatReseau`, plans, décisions |
| 🔗 Communication inter-agents | **Webhooks A2A**, Agent Cards, enveloppes JSON |
| 🗄️ Persistance | **MongoDB Atlas** (Data API) |
| 📡 Source de données | **API ODRE / eco2mix** (RTE) + dataset figé de repli |
| 🐍 Génération & outillage | **Python** |
| 🐳 Infrastructure | **Docker**, **FastMCP** |

> ⚠️ **Contrainte d'implémentation assumée** : les workflows n'utilisent **aucun nœud personnalisé**. Ils sont exclusivement composés de composants natifs de la plateforme (`Webhook`, `API Request`, `Prompt Template`, `Type Converter`, `Conditional Router`, `Agent`, `MistralAI`). Les JSON de `workflows/` sont **générés par script**, ce qui garantit cette propriété et maintient les Agent Cards synchronisés.

---

## 🔄 Flux de données

```
          ┌──────────────────────┐
          │  Webhook / Planif.   │
          └──────────┬───────────┘
                     ▼
      ┌──────────────────────────────┐
      │  1️⃣  AGENT SIMULATEUR         │
      │  API ODRE ──✖──► fallback     │
      │  dataset figé (13/12/2025)   │
      └──────────────┬───────────────┘
                     │  A2A : { action: "etat_reseau", profil_horaire, fallback }
                     ▼
      ┌──────────────────────────────┐
      │  2️⃣  AGENT DE CALCUL          │
      │  Arbitrage horaire × 360 h   │
      │  production │ batterie │ grid │
      └──────────────┬───────────────┘
                     │
        ┌────────────┴─────────────┐
        │   déficit résiduel ?     │
        └────┬────────────────┬────┘
        OUI ⚠️                │ ✅ NON
             ▼                │
┌─────────────────────────┐   │
│ 3️⃣  AGENT PLAN (RAG)     │   │
│  recherche RAG          │   │
│  Mistral → délestage    │   │
│  ┌───────────────────┐  │   │
│  │ faithfulness OK ? │  │   │
│  └───┬───────────┬───┘  │   │
│  NON │ (1× max)  │ OUI  │   │
│      └► reformule RAG   │   │
└────────────┬────────────┘   │
             │  A2A : { plan justifié, sources, rag_fallback }
             ▼                ▼
      ┌──────────────────────────────┐
      │  4️⃣  AGENT JOURNAL            │
      │  horodatage serveur          │
      │  MongoDB (retry ×3) ─► local │
      │  métriques énergie + RAG     │
      └──────────────┬───────────────┘
                     ▼
            📊 Dashboard 15 jours
```

### Chemins de dégradation

| Panne | Comportement | Marqueur |
|---|---|---|
| 🛰️ API ODRE injoignable | Bascule sur le dataset figé du 13/12/2025 | `fallback: true` |
| 📚 Corpus RAG injoignable | Règles de secours embarquées | `rag_fallback: true` |
| 🔍 Justification non fidèle | Reformulation RAG (1× maximum) | `faithfulness` |
| 🗄️ Écriture MongoDB en échec | Retry ×3 (backoff), puis écriture locale | `secours: ecriture_locale` |

---

## 📁 Structure du dépôt

```
EQUILIBRIA/
├── workflows/                  # 4 workflows, à importer dans la plateforme
│   ├── 01_Agent_Simulateur.json
│   ├── 02_Agent_Calcul.json
│   ├── 03_Agent_Plan.json
│   └── 04_Agent_Journal.json
├── agent_cards/                # 4 descripteurs A2A (discover / delegate)
├── corpus_regles_rag.json      # corpus RAG : équité, priorités, historique
├── data_test.json              # profil horaire réel du 13/12/2025
├── payload_test_calcul.json    # fixture de test (Agent de Calcul isolé)
└── generer_flows_defi10.py     # générateur des workflows et des agent cards
```

---

## 🚀 Installation

### Prérequis

| | Version | Pourquoi |
|---|---|---|
| **Python** | 3.11+ | le code utilise la syntaxe `X \| None` |
| **Node.js** | 18+ | Next.js 14 |
| **MongoDB** | local ou [Atlas](https://www.mongodb.com/atlas) (gratuit) | persiste runs, décisions, météo, SCADA |

### 1. Dépendances

```bash
# Backend + moteur (agent_simulation, agent_calcul, scada, ems)
pip install -r gridbalance-app/backend/requirements.txt

# Frontend
cd gridbalance-app/frontend && npm install && cd ../..

# Optionnel — serveur MCP (outils des agents ABA Fusion)
pip install -r gridbalance-mcp/requirements.txt
```

### 2. Configuration

```bash
cp gridbalance-app/.env.example gridbalance-app/.env
```

Puis renseignez **`MONGO_URL`** dans `gridbalance-app/.env` :

```ini
MONGO_URL=mongodb://localhost:27017                     # MongoDB local
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/  # Atlas
```

> ⚠️ **`MONGO_URL=memory`** (le défaut) lance le projet sans rien installer, mais la base
> vit dans le process du backend : la météo ne peut pas y être ingérée, donc **la tuile
> temps réel et les pages SCADA/EMS resteront vides**. Pour une démo complète, utilisez
> un vrai MongoDB.

### 3. Créer la base

```bash
python init_projet.py           # vérifie tout, puis remplit la base
python init_projet.py --check   # diagnostic seul, n'écrit rien
```

Le script vérifie Python, les paquets, le `.env`, le dataset et la connexion **avant**
d'écrire, puis :

| Étape | Collection | Contenu |
|---|---|---|
| Météo | `weather` | 6 575 h NASA 2023 (depuis `Data2023.xlsx`) |
| Équipements | `scada_telemetry` | 792 mesures (11 équipements × 72 h) |
| | `ems_setpoints` | 72 consignes horaires |

Les **index**, les **3 utilisateurs démo** et la **config** sont créés automatiquement
au premier démarrage du backend — rien à faire.

### 4. Lancer

```bash
# Terminal 1 — backend
cd gridbalance-app/backend
python -m uvicorn app.main:app --port 8000

# Terminal 2 — frontend
cd gridbalance-app/frontend
npm run dev
```

→ **http://localhost:3000**

| Compte | Mot de passe | Rôle |
|---|---|---|
| `operator@demo.ma` | `demo1234` | simuler, proposer un plan |
| `supervisor@demo.ma` | `demo1234` | valider / rejeter |
| `admin@demo.ma` | `demo1234` | tout + administration |

---

## 🔌 Workflows ABA Fusion *(optionnel)*

Le dashboard fonctionne seul (`WF_MODE=stub` : les 4 agents sont simulés en interne).
Pour brancher la plateforme agentique :

```bash
# 1. Importer les 4 JSON de workflows/ dans ABA Fusion,
#    puis relever l'endpoint de chaque nœud Webhook

# 2. Reporter les 4 URLs dans gridbalance-app/.env (WF1_URL ... WF4_URL)
#    et passer WF_MODE=live

# 3. Déclencher la chaîne complète
python push_simulation.py --anchor now --seed 42
```

> ⚠️ **La plateforme régénère l'identifiant de chaque flow à l'import.** Après un
> réimport, les anciennes URLs renvoient 404 et les liens A2A internes sont à
> refaire dans l'UI. Une fois les flows configurés, **ne les réimportez plus** :
> éditez-les à la souris.
