# -*- coding: utf-8 -*-
"""
Genere les 4 flows Langflow du Defi 10 (equilibrage reseau) a partir des noeuds
EXISTANTS clones depuis Projet_Agent1.json / Projet_Agent2.json.

Aucun custom node : on ne fait que du value-swap sur les templates exportes.
Sorties :
  ./workflows/01_Agent_Simulateur.json ... 04_Agent_Journal.json  (a importer dans Langflow)
  ./agent_cards/01_agent_simulateur.json ...                      (descripteurs A2A)
"""
import copy
import json
import os
import uuid

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "workflows")
CARDS = os.path.join(BASE, "agent_cards")
Q = "œ"  # substitut du guillemet dans les handles (idiome de la plateforme)

# --------------------------------------------------------------------------
# IDs de flow FIXES : l'endpoint A2A de la plateforme est /api/v1/webhook/<flow_id>
# (verifie sur les exports : Projet_Agent1 poste vers webhook/<id de Projet_Agent2>).
# En figeant les ids ici, les 4 agents sont pre-cables entre eux des l'import.
# --------------------------------------------------------------------------
# /!\ La plateforme REGENERE l'id a chaque import : ces valeurs sont celles des flows
# reellement importes le 14/07/2026. Si tu reimportes, releve les nouveaux endpoints
# dans les noeuds Webhook et remets-les ici.
ID_SIMULATEUR = "4c5e6646-3a07-4518-b4d4-009d20fef2c8"
ID_CALCUL = "97605288-6a52-4949-a5e1-296f3f78f22e"
ID_PLAN = "28b0da9b-d6b1-4b39-84ea-d32dfb7cfcd1"
ID_JOURNAL = "1f8f820c-e341-4394-bd2d-72d9b9c14140"

WH = "https://stg-agentic.abafusion.ai/api/v1/webhook/"
URL_CALCUL = WH + ID_CALCUL
URL_PLAN = WH + ID_PLAN
URL_JOURNAL = WH + ID_JOURNAL

URL_ODRE = (
    "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/"
    "eco2mix-national-tr/records?select=date_heure,consommation,eolien,solaire,"
    "nucleaire,gaz,hydraulique,fioul,charbon,taux_co2&order_by=date_heure%20desc&limit=100"
)
# Corpus RAG (regles d'equite / priorites / historique) : servi en HTTP.
# Publie corpus_regles_rag.json dans un Gist GitHub public et colle ici l'URL "raw".
URL_RAG = "https://raw.githubusercontent.com/REMPLACER-USER/REMPLACER-GIST/main/corpus_regles_rag.json"
URL_MONGO = (
    "https://eu-central-1.aws.data.mongodb-api.com/app/REMPLACER-APP-ID/endpoint/"
    "data/v1/action/insertOne"
)

# Dataset fige du 13/12/2025 (vrai jour sans vent : eolien moyen 504 MW = 0,9% de la conso).
# Embarque dans le prompt de fallback => l'agent 1 fonctionne meme sans sortie Internet.
with open(os.path.join(BASE, "data_test.json"), encoding="utf-8") as fh:
    DATASET_FIGE = json.dumps(json.load(fh), separators=(",", ":"))

# --------------------------------------------------------------------------
# Bibliotheque de noeuds : on charge les exports et on indexe par type
# --------------------------------------------------------------------------
# Source : les exports d'origine si presents, sinon les flows deja generes (memes templates).
import glob

SOURCES = [p for p in (os.path.join(BASE, f) for f in
                       ("Projet_Agent1.json", "Projet_Agent2.json")) if os.path.exists(p)]
if not SOURCES:
    SOURCES = sorted(glob.glob(os.path.join(OUT, "0*.json")))
if not SOURCES:
    raise SystemExit("Aucune bibliotheque de noeuds : remets Projet_Agent1.json / "
                     "Projet_Agent2.json dans le dossier, ou garde flows_defi10/.")

LIB = {}
for src in SOURCES:
    with open(src, encoding="utf-8") as fh:
        for node in json.load(fh)["data"]["nodes"]:
            LIB.setdefault(node["data"]["type"], copy.deepcopy(node))

# Metadonnees de handles, relevees directement sur les exports
OUTPUTS = {
    "Webhook":                ("output_data", ["Data"]),
    "ChatInput":              ("message", ["Message"]),
    "ChatOutput":             ("message", ["Message"]),
    "Prompt Template":        ("prompt", ["Message"]),
    "TypeConverterComponent": ("data_output", ["Data"]),
    "APIRequest":             ("data", ["Data"]),
    "Agent":                  ("response", ["Message"]),
    "MistralModel":           ("text_output", ["Message"]),
}
INPUTS = {
    ("ChatOutput", "input_value"):             (["Data", "DataFrame", "Message"], "other"),
    ("Agent", "input_value"):                  (["Message"], "str"),
    ("Prompt Template", "input"):              (["Message"], "str"),
    ("TypeConverterComponent", "input_data"):  (["Message", "Data", "DataFrame"], "other"),
    ("APIRequest", "body"):                    (["Data"], "table"),
    ("ConditionalRouter", "input_text"):       (["Message"], "str"),
    ("MistralModel", "input_value"):           (["Message"], "str"),
}
ROUTER_OUT = {"true": ("true_result", ["Message"]), "false": ("false_result", ["Message"])}


class Flow:
    def __init__(self, name, description, flow_id=None):
        self.flow_id = flow_id or str(uuid.uuid4())
        self.name = name
        self.description = description
        self.nodes = []
        self.edges = []
        self.types = {}   # node_id -> node type
        self._n = 0

    def add(self, ntype, display_name, values=None, pos=(0, 0), outputs=None):
        """Clone un noeud existant, lui donne un nouvel id et remplace les valeurs."""
        self._n += 1
        nid = "%s-%s" % (ntype.replace(" ", ""), uuid.uuid4().hex[:5])
        node = copy.deepcopy(LIB[ntype])
        node["id"] = nid
        node["position"] = {"x": pos[0], "y": pos[1]}
        node["selected"] = False
        node["data"]["id"] = nid
        nd = node["data"]["node"]
        nd["display_name"] = display_name
        tpl = nd["template"]
        if "_frontend_node_flow_id" in tpl:
            tpl["_frontend_node_flow_id"]["value"] = self.flow_id
        for k, v in (values or {}).items():
            if k not in tpl:
                raise KeyError("champ '%s' absent du template %s" % (k, ntype))
            tpl[k]["value"] = v
        if outputs is not None:
            nd["outputs"] = outputs
        self.types[nid] = ntype
        self.nodes.append(node)
        return nid

    def link(self, source, target, field, out=None):
        """Cree une arete. `out` force le nom de sortie (routers : 'true'/'false')."""
        stype, ttype = self.types[source], self.types[target]
        if stype == "ConditionalRouter":
            oname, otypes = ROUTER_OUT[out or "true"]
        else:
            oname, otypes = OUTPUTS[stype]
        itypes, ftype = INPUTS[(ttype, field)]

        sh = {"dataType": stype, "id": source, "name": oname, "output_types": otypes}
        th = {"fieldName": field, "id": target, "inputTypes": itypes, "type": ftype}
        enc = lambda h: json.dumps(h, separators=(",", ":")).replace('"', Q)
        self.edges.append({
            "animated": False,
            "className": "",
            "data": {"sourceHandle": sh, "targetHandle": th},
            "id": "reactflow__edge-%s%s-%s%s" % (source, enc(sh), target, enc(th)),
            "selected": False,
            "source": source,
            "sourceHandle": enc(sh),
            "target": target,
            "targetHandle": enc(th),
        })

    def dump(self, filename):
        payload = {
            "data": {
                "edges": self.edges,
                "nodes": self.nodes,
                "viewport": {"x": 0, "y": 0, "zoom": 0.5},
            },
            "description": self.description,
            "endpoint_name": None,
            "id": self.flow_id,
            "is_component": False,
            "last_tested_version": "1.7.0",
            "name": self.name,
            "tags": [],
        }
        path = os.path.join(OUT, filename)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        print("  %-28s %2d noeuds / %2d aretes" % (filename, len(self.nodes), len(self.edges)))
        return self.flow_id


def a2a(target_agent, action, payload_lines):
    """Enveloppe A2A dans un Prompt Template (accolades litterales doublees)."""
    body = "\n".join('    "%s": %s,' % (k, v) for k, v in payload_lines).rstrip(",")
    return (
        "{input}\n\n"
        "{{\n"
        '  "from": "agent_%s",\n'
        '  "action": "%s",\n'
        '  "payload": {{\n%s\n  }}\n'
        "}}"
    ) % (target_agent, action, body.replace("{", "{{").replace("}", "}}"))


# ==========================================================================
# FLOW 1 — Agent Simulateur : etat reseau (ODRE) -> Agent Calcul
# ==========================================================================
def flow_simulateur():
    f = Flow("01_Agent_Simulateur", "Defi 10 - Agent Simulateur : collecte ODRE/meteo, "
                                    "fallback dataset fige, envoi A2A a l'Agent Calcul.",
             flow_id=ID_SIMULATEUR)
    hook = f.add("Webhook", "Declenchement (webhook / planif)", pos=(-200, 300))
    trig = f.add("ChatOutput", "Trigger recu", pos=(150, 300))

    api = f.add("APIRequest", "Appeler API ODRE / meteo (15j)", {
        "method": "GET",
        "url_input": URL_ODRE,
        "headers": [{"key": "Accept", "value": "application/json"}],
        "body": [],
        "timeout": 30,
    }, pos=(500, 300))

    resp = f.add("ChatOutput", "Reponse ODRE", pos=(850, 300))

    gw = f.add("ConditionalRouter", "API disponible ?", {
        "input_text": "",
        "match_text": "date_heure",
        "operator": "contains",
        "case_sensitive": False,
        "default_route": "false_result",
    }, pos=(1200, 300))

    p_ok = f.add("Prompt Template", "Parser / structurer (EtatReseau)", {
        "template": a2a("simulateur", "etat_reseau", [
            ("source", '"odre_eco2mix_tr"'),
            ("horizon_heures", "360"),
            ("fallback", "false"),
            ("schema", '"EtatReseau: date_heure, consommation_mw, eolien_mw, solaire_mw, thermique_mw"'),
        ])}, pos=(1550, 120))
    tc_ok = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(1900, 120))
    send_ok = f.add("APIRequest", "Envoyer a Agent Calcul (A2A)", {
        "method": "POST", "url_input": URL_CALCUL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(2250, 120))

    p_fb = f.add("Prompt Template", "Fallback : dataset fige 13/12/2025 (jour sans vent)", {
        "template": a2a("simulateur", "etat_reseau", [
            ("source", '"dataset_fige_13_12_2025"'),
            ("horizon_heures", "360"),
            ("fallback", "true"),
            ("note", '"API ODRE indisponible - jour sans vent reel (eolien moyen 504 MW = 0.9% de la conso)"'),
            ("profil_horaire_24h", DATASET_FIGE),
        ])}, pos=(1550, 520))
    tc_fb = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(1900, 520))
    send_fb = f.add("APIRequest", "Envoyer a Agent Calcul (A2A)", {
        "method": "POST", "url_input": URL_CALCUL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(2250, 520))

    end = f.add("ChatOutput", "Donnees reseau transmises", pos=(2600, 300))

    f.link(hook, trig, "input_value")
    f.link(api, resp, "input_value")
    f.link(resp, gw, "input_text")
    f.link(gw, p_ok, "input", out="true")
    f.link(p_ok, tc_ok, "input_data")
    f.link(tc_ok, send_ok, "body")
    f.link(send_ok, end, "input_value")
    f.link(gw, p_fb, "input", out="false")
    f.link(p_fb, tc_fb, "input_data")
    f.link(tc_fb, send_fb, "body")
    f.link(send_fb, end, "input_value")
    return f


# ==========================================================================
# FLOW 2 — Agent Calcul : arbitrage horaire sur 360h
# ==========================================================================
SYS_CALCUL = """Tu es l'Agent Calcul d'un systeme d'equilibrage de reseau electrique.

ENTREE : un message JSON de l'Agent Simulateur contenant l'etat du reseau national
(cle "profil_horaire_24h" : conso_mw, eolien_mw, solaire_mw pour 24 heures, ou les
enregistrements bruts de l'API ODRE eco2mix). C'est ta SEULE entree externe.

Tu NE DEMANDES JAMAIS de donnees supplementaires : tout ce qui manque est fixe par
les hypotheses ci-dessous. Si une donnee est absente, applique l'hypothese et
signale-le dans "hypotheses_appliquees".

--- HYPOTHESES DU SCENARIO (font autorite) ---

1) HORIZON : 15 jours = 360 heures. Le profil horaire fourni couvre 24 h : replique-le
   a l'identique sur les 15 jours (jour type = 13/12/2025, jour sans vent).

2) BESOIN HORAIRE DE L'ENTREPRISE (site industriel) :
   - 00h-06h :  6 MW      - 06h-08h : 10 MW      - 08h-18h : 15 MW
   - 18h-22h : 11 MW      - 22h-24h :  7 MW
   - Samedi et dimanche (jours 6, 7, 13, 14 de l'horizon) : besoin x 0.5

3) PRODUCTION RENOUVELABLE DU SITE, derivee du profil national par facteur de charge :
   - facteur_eolien(h)  = eolien_mw(h)  / 24000   (capacite eolienne nationale ~24 GW)
   - facteur_solaire(h) = solaire_mw(h) / 21000   (capacite solaire nationale ~21 GW)
   - production_site(h) = 12 MW * facteur_eolien(h) + 8 MW * facteur_solaire(h)
     (parc du site : 12 MW eolien crete + 8 MW solaire crete)

4) BATTERIE — c'est un STOCK, pas une source illimitee. Contraintes ABSOLUES :
   - capacite 40 MWh ; etat de charge initial 20 MWh
   - puissance max : 10 MW en charge comme en decharge (donc <= 10 MWh par heure)
   - rendement aller-retour : 0.92 (applique a la charge)
   - cout d'usure / amortissement : 45 EUR/MWh decharge
   - RECHARGE UNIQUEMENT par le surplus de production (production - besoin > 0).
     Il est INTERDIT de recharger la batterie depuis le reseau.
   - Tu DOIS suivre l'etat de charge (soc_mwh) heure par heure. La decharge d'une
     heure ne peut jamais depasser min(10, soc_mwh disponible).
   - Un jour sans vent, le surplus est quasi nul : la batterie est donc une reserve
     de 20 MWh a placer intelligemment, elle ne se reconstitue presque pas.

5) TARIF HORAIRE ANRE (achat au reseau, EUR/MWh) :
   - 00h-06h et 22h-24h (heures creuses)      :  60
   - 08h-18h (journee)                        :  95
   - 06h-08h et 20h-22h (heures pleines)      : 140
   - 18h-20h (pointe hiver)                   : 210

6) RESEAU : la puissance souscrite au grid est plafonnee a 12 MW. Au-dela, le reseau
   ne peut PAS livrer : l'energie manquante devient du deficit residuel.

--- FIN DES HYPOTHESES ---

Pour CHAQUE heure, dans l'ordre chronologique, en maintenant soc_mwh :
1. production_mwh = min(besoin, production_site). Le surplus eventuel
   (production_site - besoin) recharge la batterie, dans la limite de 10 MW et de la
   capacite de 40 MWh, avec le rendement 0.92.
2. deficit = besoin - production_mwh.
3. batterie_mwh = decharge. Plafond : min(deficit, 10, soc_mwh).
   La batterie est une reserve RARE (20 MWh, quasi pas rechargee un jour sans vent) :
   ne la gaspille pas sur les heures bon marche. Ordre de priorite strict :
   a. D'ABORD les heures ou le grid plafonne, c'est-a-dire ou (deficit - 12) > 0 :
      sans la batterie ces heures deviennent du deficit residuel non couvert, ce qui
      coute infiniment plus cher qu'un MWh. Ce sont typiquement les heures 8h-10h et
      14h-17h, ou le besoin est de 15 MW et la production solaire faible.
   b. ENSUITE, s'il reste du soc, les heures les plus cheres (pointe 18h-20h a 210,
      puis heures pleines a 140).
   c. JAMAIS en heures creuses (60) tant qu'une heure de la categorie (a) reste
      decouverte ailleurs dans l'horizon.
   Mets a jour soc_mwh -= batterie_mwh.
4. grid_mwh = min(deficit - batterie_mwh, 12).
5. deficit_residuel_mwh += (deficit - batterie_mwh - grid_mwh) si positif.

Enregistre pour chaque heure :
{"heure", "besoin_mwh", "production_mwh", "batterie_mwh", "grid_mwh", "soc_mwh",
 "deficit_mwh", "cout"}
Le cout de l'heure = batterie_mwh * 45 + grid_mwh * tarif_anre(heure).

CONTROLE OBLIGATOIRE avant de repondre : pour chaque heure, verifie que
besoin = production_mwh + batterie_mwh + grid_mwh + deficit_mwh, que soc_mwh reste
entre 0 et 40, que batterie_mwh <= 10 et que grid_mwh <= 12. Si un controle echoue,
recalcule. Ne rends jamais un plan qui viole ces bornes.

Le deficit residuel est l'energie qu'aucune des trois sources ne peut fournir : il
apparait quand le besoin depasse production + batterie disponible + 12 MW de grid.

SORTIE : un unique objet JSON, sans markdown, de la forme
{"plan": [ ... les 24 heures du jour type, au format ci-dessus ... ],
 "repetition": 15,
 "cout_total": 0.0,
 "part_production": 0.0, "part_batterie": 0.0, "part_grid": 0.0,
 "deficit_residuel_mwh": 0.0,
 "heures_en_deficit": [18, 19],
 "hypotheses_appliquees": ["..."]}

part_production, part_batterie et part_grid sont des FRACTIONS entre 0 et 1 (part de
l'energie totale consommee sur les 360 heures). Leur somme + la part de deficit = 1.
cout_total et deficit_residuel_mwh portent sur les 360 heures (24 h x 15 jours, avec
le besoin reduit de moitie les 4 jours de week-end).

Termine imperativement ta reponse par un seul de ces deux jetons :
- DEFICIT_RESIDUEL  si deficit_residuel_mwh > 0 (des heures restent non couvertes)
- EQUILIBRE_OK      si tout le besoin est couvert
"""


def flow_calcul():
    f = Flow("02_Agent_Calcul", "Defi 10 - Agent Calcul : arbitrage horaire production/batterie/grid "
                                "sur 360h, routage vers Agent Plan ou Agent Journal.",
             flow_id=ID_CALCUL)
    hook = f.add("Webhook", "Reception donnees (A2A depuis Simulateur)", pos=(-200, 300))
    rx = f.add("ChatOutput", "Charger 2 flux : besoin + prod/batterie", pos=(150, 300))

    agent = f.add("Agent", "Arbitrage horaire (360h)", {
        "agent_llm": "Google Generative AI",
        "model_name": "gemini-2.5-flash",
        "temperature": 0.1,
        "system_prompt": SYS_CALCUL,
        "add_current_date_tool": False,
    }, pos=(520, 300))

    gw = f.add("ConditionalRouter", "Deficit residuel non couvert ?", {
        "match_text": "DEFICIT_RESIDUEL",
        "operator": "contains",
        "case_sensitive": True,
        "default_route": "false_result",
    }, pos=(900, 300))

    p_plan = f.add("Prompt Template", "Envoyer a Agent Plan de reequilibrage (A2A)", {
        "template": a2a("calcul", "reequilibrage_requis", [
            ("motif", '"deficit_residuel_non_couvert"'),
            ("horizon_heures", "360"),
        ])}, pos=(1260, 120))
    tc_plan = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(1610, 120))
    send_plan = f.add("APIRequest", "Agent Plan (A2A)", {
        "method": "POST", "url_input": URL_PLAN,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(1960, 120))

    p_jour = f.add("Prompt Template", "Envoyer resultat direct a Agent Journal (A2A)", {
        "template": a2a("calcul", "plan_calcule", [
            ("statut", '"equilibre"'),
            ("deficit_residuel_mwh", "0"),
        ])}, pos=(1260, 520))
    tc_jour = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(1610, 520))
    send_jour = f.add("APIRequest", "Agent Journal (A2A)", {
        "method": "POST", "url_input": URL_JOURNAL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(1960, 520))

    end = f.add("ChatOutput", "Plan 15 jours calcule", pos=(2320, 300))

    f.link(hook, rx, "input_value")
    f.link(rx, agent, "input_value")
    f.link(agent, gw, "input_text")
    f.link(gw, p_plan, "input", out="true")
    f.link(p_plan, tc_plan, "input_data")
    f.link(tc_plan, send_plan, "body")
    f.link(send_plan, end, "input_value")
    f.link(gw, p_jour, "input", out="false")
    f.link(p_jour, tc_jour, "input_data")
    f.link(tc_jour, send_jour, "body")
    f.link(send_jour, end, "input_value")
    return f


# ==========================================================================
# FLOW 3 — Agent Plan : RAG + justification + auto-verification
# ==========================================================================
SYS_PLAN = """Tu es l'Agent Plan de reequilibrage.

A partir du deficit residuel et des PASSAGES RAG fournis (regles d'equite, priorites
de charge, historique des sites deja penalises), choisis les actions de delestage.

REGLES ABSOLUES :
- L'hopital n'est JAMAIS coupe, quelle que soit la situation.
- Rotation equitable : ne penalise pas deux fois de suite un site deja deleste.
- Justifie chaque action et CITE la source RAG utilisee (id du passage).

Si aucun passage RAG ne t'est fourni (mode degrade), applique le corpus de secours
ci-dessous et positionne "rag_fallback": true.

CORPUS DE SECOURS (regles de reference) :
- R01 site_critique  : hopital, centre de dialyse -> delestage interdit, priorite 0.
- R02 priorite_charge: 1=sante, 2=eau/assainissement, 3=industrie continue,
                       4=tertiaire, 5=eclairage non essentiel, 6=confort.
- R03 equite         : rotation obligatoire, un site deleste sur 24h glissantes est
                       exclu du tour suivant tant qu'un site de meme priorite n'a pas
                       ete sollicite.
- R04 economie       : a priorite egale, delester d'abord le site dont le cout evite
                       par MWh est le plus eleve (regle "moins cher d'abord").
- R05 plafond        : aucun site ne subit plus de 2 h consecutives de delestage.

SORTIE : un unique objet JSON, sans markdown :
{"actions": [{"site": "...", "delestage_mw": 0.0, "justification": "...",
              "sources": ["passage_id"]}],
 "rag_fallback": false}

AUTO-VERIFICATION (faithfulness) : relis ton plan. Chaque justification est-elle
reellement soutenue par un passage cite ? Termine par un seul jeton :
- FAITHFUL_OK    si oui
- FAITHFUL_KO    si une justification n'est pas soutenue par les sources
"""

RAG_QUERY = ("Regles d'equite de delestage, priorites de charge, sites critiques "
             "(hopital), historique des sites deja penalises")


def flow_plan():
    f = Flow("03_Agent_Plan", "Defi 10 - Agent Plan : RAG regles d'equite, choix d'action justifie, "
                              "auto-verification faithfulness (1 reformulation max).",
             flow_id=ID_PLAN)
    hook = f.add("Webhook", "Reception deficit residuel (A2A depuis Calcul)", pos=(-250, 300))
    rx = f.add("ChatOutput", "Deficit residuel recu", pos=(80, 300))

    p_q = f.add("Prompt Template", "Requete RAG (equite, priorites, historique)", {
        "template": "{input}\n\n{{\n  \"query\": \"%s\",\n  \"top_k\": 5\n}}" % RAG_QUERY,
    }, pos=(410, 300))
    tc_q = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(740, 300))
    rag = f.add("APIRequest", "RAG search", {
        "method": "GET", "url_input": URL_RAG,
        "headers": [{"key": "Accept", "value": "application/json"}],
    }, pos=(1070, 300))
    rag_out = f.add("ChatOutput", "Passages RAG", pos=(1400, 300))

    gw1 = f.add("ConditionalRouter", "Passages pertinents trouves ?", {
        "match_text": "passage_id",
        "operator": "contains",
        "case_sensitive": False,
        "default_route": "false_result",
    }, pos=(1730, 300))

    # --- branche OUI : Mistral choisit l'action + redige la justification
    mistral = f.add("MistralModel", "Mistral : choisir action + justifier + citer sources", {
        "model_name": "codestral-latest",
        "temperature": 0.1,
        "system_message": SYS_PLAN,
    }, pos=(2060, 100))
    m_out = f.add("ChatOutput", "Plan redige", pos=(2390, 100))

    gw2 = f.add("ConditionalRouter", "Auto-verification : coherente avec sources ?", {
        "match_text": "FAITHFUL_OK",
        "operator": "contains",
        "case_sensitive": True,
        "default_route": "false_result",
    }, pos=(2720, 100))

    # --- OUI -> plan final vers Journal
    p_fin = f.add("Prompt Template", "Plan final justifie", {
        "template": a2a("plan", "plan_justifie", [
            ("rag_fallback", "false"),
            ("faithfulness", '"ok"'),
        ])}, pos=(3050, -80))
    tc_fin = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(3380, -80))
    send_fin = f.add("APIRequest", "Envoyer plan final a Agent Journal (A2A)", {
        "method": "POST", "url_input": URL_JOURNAL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(3710, -80))

    # --- NON (1x max) -> reformuler la requete RAG, 2e passe deroulee (pas de cycle)
    p_re = f.add("Prompt Template", "Reformuler la requete RAG (1 seule fois max)", {
        "template": ("{input}\n\n{{\n  \"query\": \"%s - reformulation : cite explicitement "
                     "les identifiants de passage\",\n  \"top_k\": 8,\n  \"retry\": 1\n}}" % RAG_QUERY),
    }, pos=(3050, 320))
    tc_re = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(3380, 320))
    rag2 = f.add("APIRequest", "RAG search (2e passe)", {
        "method": "GET", "url_input": URL_RAG,
        "headers": [{"key": "Accept", "value": "application/json"}],
    }, pos=(3710, 320))
    rag2_out = f.add("ChatOutput", "Passages RAG (2e passe)", pos=(4040, 320))
    mistral2 = f.add("MistralModel", "Mistral : plan (apres reformulation)", {
        "model_name": "codestral-latest",
        "temperature": 0.1,
        "system_message": SYS_PLAN,
    }, pos=(4370, 320))
    tc_re2 = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(4700, 320))
    send_re = f.add("APIRequest", "Envoyer plan (2e passe) a Agent Journal (A2A)", {
        "method": "POST", "url_input": URL_JOURNAL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(5030, 320))

    # --- branche NON du 1er gateway : fallback regle par defaut
    p_fb = f.add("Prompt Template", "Fallback : regle par defaut (moins cher d'abord)", {
        "template": a2a("plan", "plan_fallback", [
            ("regle", '"moins_cher_dabord"'),
            ("rag_fallback", "true"),
            ("contrainte", '"hopital jamais coupe"'),
        ])}, pos=(2060, 700))
    tc_fb = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(2390, 700))
    send_fb = f.add("APIRequest", "Envoyer plan fallback a Agent Journal (A2A)", {
        "method": "POST", "url_input": URL_JOURNAL,
        "headers": [{"key": "Content-Type", "value": "application/json"}],
    }, pos=(2720, 700))

    end = f.add("ChatOutput", "Plan justifie transmis", pos=(5400, 300))

    f.link(hook, rx, "input_value")
    f.link(rx, p_q, "input")
    f.link(p_q, tc_q, "input_data")
    f.link(tc_q, rag, "body")
    f.link(rag, rag_out, "input_value")
    f.link(rag_out, gw1, "input_text")

    f.link(gw1, mistral, "input_value", out="true")
    f.link(mistral, m_out, "input_value")
    f.link(m_out, gw2, "input_text")

    f.link(gw2, p_fin, "input", out="true")
    f.link(p_fin, tc_fin, "input_data")
    f.link(tc_fin, send_fin, "body")
    f.link(send_fin, end, "input_value")

    f.link(gw2, p_re, "input", out="false")
    f.link(p_re, tc_re, "input_data")
    f.link(tc_re, rag2, "body")
    f.link(rag2, rag2_out, "input_value")
    f.link(rag2_out, mistral2, "input_value")
    f.link(mistral2, tc_re2, "input_data")
    f.link(tc_re2, send_re, "body")
    f.link(send_re, end, "input_value")

    f.link(gw1, p_fb, "input", out="false")
    f.link(p_fb, tc_fb, "input_data")
    f.link(tc_fb, send_fb, "body")
    f.link(send_fb, end, "input_value")
    return f


# ==========================================================================
# FLOW 4 — Agent Journal : horodatage, MongoDB, metriques, dashboard
# ==========================================================================
SYS_METRIQUES = """Tu es l'Agent Journal. A partir de la decision journalisee, agrege et
renvoie UN SEUL objet JSON, sans markdown :

{"metriques_energie": {"cout_total": 0.0, "part_batterie": 0.0, "part_grid": 0.0,
                       "heures_en_deficit": 0},
 "metriques_rag": {"taux_citation": 0.0, "faithfulness": 0.0, "taux_fallback": 0.0},
 "rapport_15_jours": {"periode": "...", "resume": "..."}}

Le taux de citation = part des actions dont la justification cite au moins une source.
Le taux de fallback = part des decisions ou rag_fallback vaut true.
"""


def flow_journal():
    f = Flow("04_Agent_Journal", "Defi 10 - Agent Journal : horodatage, ecriture MongoDB Atlas, "
                                 "retry, agregation des metriques energie + RAG, dashboard 15 jours.",
             flow_id=ID_JOURNAL)
    hook = f.add("Webhook", "Reception decision (A2A depuis Calcul ou Plan)", pos=(-250, 300))
    rx = f.add("ChatOutput", "Decision recue", pos=(80, 300))

    p_ts = f.add("Prompt Template", "Horodatage serveur (anti-falsification)", {
        "template": (
            "{input}\n\n"
            "{{\n"
            '  "dataSource": "Cluster0",\n'
            '  "database": "gridbalance",\n'
            '  "collection": "journal_decisions",\n'
            '  "document": {{\n'
            '    "horodatage_serveur": "$$NOW",\n'
            '    "source": "agent_calcul|agent_plan"\n'
            "  }}\n"
            "}}"
        )}, pos=(410, 300))
    tc_ts = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(740, 300))

    mongo = f.add("APIRequest", "Ecrire dans MongoDB (Atlas Data API) journal_decisions", {
        "method": "POST", "url_input": URL_MONGO,
        "headers": [
            {"key": "Content-Type", "value": "application/json"},
            {"key": "apiKey", "value": "REMPLACER-PAR-CLE-ATLAS-DATA-API"},
        ],
    }, pos=(1070, 300))
    mongo_out = f.add("ChatOutput", "Reponse MongoDB", pos=(1400, 300))

    gw = f.add("ConditionalRouter", "Ecriture reussie ?", {
        "match_text": "insertedId",
        "operator": "contains",
        "case_sensitive": False,
        "default_route": "false_result",
    }, pos=(1730, 300))

    # --- OUI : agregation des metriques
    agg = f.add("Agent", "Agreger metriques (cout, batterie/grid, deficit) + metriques RAG", {
        "agent_llm": "Google Generative AI",
        "model_name": "gemini-2.5-flash",
        "temperature": 0.1,
        "system_prompt": SYS_METRIQUES,
        "add_current_date_tool": True,
    }, pos=(2060, 120))
    end = f.add("ChatOutput", "Decision journalisee + metriques a jour (dashboard 15 jours)",
                pos=(2420, 300))

    # --- NON : retry x3 avec backoff, sinon ecriture locale de secours
    p_rt = f.add("Prompt Template", "Retry x3 avec backoff, sinon ecriture locale de secours", {
        "template": (
            "{input}\n\n"
            "{{\n"
            '  "retry": {{ "tentatives": 3, "backoff": "exponentiel" }},\n'
            '  "secours": "ecriture_locale",\n'
            '  "dataSource": "Cluster0",\n'
            '  "database": "gridbalance",\n'
            '  "collection": "journal_decisions"\n'
            "}}"
        )}, pos=(2060, 560))
    tc_rt = f.add("TypeConverterComponent", "Type Convert", {"output_type": "Data"}, pos=(2390, 560))
    retry = f.add("APIRequest", "Reecriture MongoDB (retry)", {
        "method": "POST", "url_input": URL_MONGO, "timeout": 60,
        "headers": [
            {"key": "Content-Type", "value": "application/json"},
            {"key": "apiKey", "value": "REMPLACER-PAR-CLE-ATLAS-DATA-API"},
        ],
    }, pos=(2720, 560))

    f.link(hook, rx, "input_value")
    f.link(rx, p_ts, "input")
    f.link(p_ts, tc_ts, "input_data")
    f.link(tc_ts, mongo, "body")
    f.link(mongo, mongo_out, "input_value")
    f.link(mongo_out, gw, "input_text")
    f.link(gw, agg, "input_value", out="true")
    f.link(agg, end, "input_value")
    f.link(gw, p_rt, "input", out="false")
    f.link(p_rt, tc_rt, "input_data")
    f.link(tc_rt, retry, "body")
    f.link(retry, end, "input_value")
    return f


# ==========================================================================
# AGENT CARDS — descripteurs A2A (un par agent), consommes par l'action "discover"
# ==========================================================================
def card(agent_id, name, description, url, skills, entree, sortie, envoie_vers,
         dependances):
    return {
        "protocol_version": "a2a/1.0",
        "id": agent_id,
        "name": name,
        "description": description,
        "version": "1.0.0",
        "provider": {"organization": "Defi 10 - Equilibrage reseau",
                     "platform": "ABA Fusion (Langflow 1.7.0)"},
        "url": url,
        "capabilities": {"streaming": False, "push_notifications": True,
                         "state_transition_history": False},
        "default_input_modes": ["application/json"],
        "default_output_modes": ["application/json"],
        "skills": skills,
        "input_schema": entree,
        "output_schema": sortie,
        "sends_to": envoie_vers,
        "dependencies": dependances,
    }


CARDS_DEF = [
    ("01_agent_simulateur.json", card(
        "agent_simulateur", "Agent Simulateur",
        "Collecte l'etat du reseau electrique (production eolienne, solaire, thermique "
        "et consommation) sur un horizon de 15 jours. Bascule sur un dataset fige du "
        "13/12/2025 (jour sans vent reel) si l'API ODRE est indisponible.",
        WH + ID_SIMULATEUR,
        [{"id": "collecte_etat_reseau", "name": "Collecte de l'etat reseau",
          "description": "Interroge l'API ODRE eco2mix et structure les donnees en EtatReseau.",
          "tags": ["reseau", "odre", "eco2mix", "meteo"],
          "examples": ["Recupere l'etat du reseau sur 15 jours"]},
         {"id": "fallback_dataset_fige", "name": "Fallback dataset fige",
          "description": "Sert le profil horaire reel du 13/12/2025 quand l'API est injoignable.",
          "tags": ["fallback", "resilience"], "examples": ["API ODRE en erreur 403"]}],
        {"type": "object", "properties": {
            "trigger": {"type": "string", "description": "webhook ou planification"},
            "jour": {"type": "string", "description": "date ciblee, optionnelle"}}},
        {"type": "object", "properties": {
            "from": {"const": "agent_simulateur"}, "action": {"const": "etat_reseau"},
            "payload": {"type": "object", "properties": {
                "source": {"type": "string"}, "horizon_heures": {"type": "integer"},
                "fallback": {"type": "boolean"},
                "profil_horaire_24h": {"type": "array", "items": {"type": "object"}}}}}},
        ["agent_calcul"],
        [{"type": "http", "name": "API ODRE eco2mix", "url": URL_ODRE.split("?")[0],
          "optional": True, "note": "403 depuis la plateforme : le fallback prend le relais"}])),

    ("02_agent_calcul.json", card(
        "agent_calcul", "Agent Calcul",
        "Realise l'arbitrage horaire sur 360 heures entre production directe, batterie "
        "et achat au reseau, sous contrainte de stock batterie (40 MWh) et de puissance "
        "souscrite (12 MW). Emet un plan chiffre et route selon le deficit residuel.",
        WH + ID_CALCUL,
        [{"id": "arbitrage_horaire", "name": "Arbitrage production / batterie / grid",
          "description": "Pour chaque heure : production directe, sinon batterie si moins "
                         "chere que le tarif ANRE et si l'etat de charge le permet, sinon grid.",
          "tags": ["optimisation", "arbitrage", "batterie", "anre"],
          "examples": ["Calcule le plan d'equilibrage sur 15 jours"]},
         {"id": "detection_deficit", "name": "Detection du deficit residuel",
          "description": "Identifie les heures qu'aucune source ne peut couvrir "
                         "(plafond reseau atteint) et declenche le reequilibrage.",
          "tags": ["deficit", "routage"], "examples": ["Le grid plafonne a 12 MW a 16h"]}],
        {"type": "object", "properties": {
            "from": {"const": "agent_simulateur"}, "action": {"const": "etat_reseau"},
            "payload": {"type": "object"}}},
        {"type": "object", "properties": {
            "plan": {"type": "array"}, "cout_total": {"type": "number"},
            "part_production": {"type": "number"}, "part_batterie": {"type": "number"},
            "part_grid": {"type": "number"}, "deficit_residuel_mwh": {"type": "number"},
            "heures_en_deficit": {"type": "array", "items": {"type": "integer"}}}},
        ["agent_plan", "agent_journal"],
        [{"type": "llm", "name": "Google Gemini", "model": "gemini-2.5-flash"}])),

    ("03_agent_plan.json", card(
        "agent_plan", "Agent Plan de reequilibrage",
        "Choisit les actions de delestage pour couvrir le deficit residuel, en "
        "s'appuyant sur un corpus RAG de regles d'equite. Justifie chaque action, cite "
        "ses sources et auto-verifie la fidelite de sa justification.",
        WH + ID_PLAN,
        [{"id": "rag_regles_equite", "name": "Recherche RAG des regles d'equite",
          "description": "Recupere les regles de priorite, d'equite et l'historique des "
                         "sites deja penalises.",
          "tags": ["rag", "equite", "priorites"],
          "examples": ["Quelles regles s'appliquent au delestage d'un hopital ?"]},
         {"id": "plan_delestage_justifie", "name": "Plan de delestage justifie",
          "description": "Produit les actions de delestage. Garde-fou absolu : l'hopital "
                         "n'est jamais coupe. Rotation equitable entre les sites.",
          "tags": ["delestage", "justification", "garde-fou"],
          "examples": ["Couvre 42 MWh de deficit entre 18h et 20h"]},
         {"id": "auto_verification", "name": "Auto-verification (faithfulness)",
          "description": "Verifie que chaque justification est soutenue par une source "
                         "citee ; reformule la requete RAG une fois au maximum si non.",
          "tags": ["faithfulness", "verification"], "examples": ["FAITHFUL_KO -> reformulation"]}],
        {"type": "object", "properties": {
            "from": {"const": "agent_calcul"}, "action": {"const": "reequilibrage_requis"},
            "payload": {"type": "object", "properties": {
                "deficit_residuel_mwh": {"type": "number"},
                "heures_en_deficit": {"type": "array"}, "sites": {"type": "array"}}}}},
        {"type": "object", "properties": {
            "actions": {"type": "array", "items": {"type": "object", "properties": {
                "site": {"type": "string"}, "delestage_mw": {"type": "number"},
                "justification": {"type": "string"}, "sources": {"type": "array"}}}},
            "rag_fallback": {"type": "boolean"}}},
        ["agent_journal"],
        [{"type": "llm", "name": "MistralAI", "model": "codestral-latest"},
         {"type": "http", "name": "Corpus RAG des regles d'equite", "url": URL_RAG,
          "optional": True,
          "note": "si injoignable : corpus de secours embarque, rag_fallback=true"}])),

    ("04_agent_journal.json", card(
        "agent_journal", "Agent Journal",
        "Horodate et journalise chaque decision dans MongoDB (collection "
        "journal_decisions), avec retry et ecriture locale de secours. Agrege les "
        "metriques energie et RAG et expose le rapport sur 15 jours.",
        WH + ID_JOURNAL,
        [{"id": "journalisation", "name": "Journalisation anti-falsification",
          "description": "Horodatage serveur puis ecriture dans MongoDB Atlas Data API.",
          "tags": ["mongodb", "audit", "horodatage"],
          "examples": ["Journalise la decision d'equilibrage du 13/12"]},
         {"id": "metriques", "name": "Agregation des metriques",
          "description": "Cout total, part batterie/grid, heures en deficit, et metriques "
                         "RAG (taux de citation, faithfulness, taux de fallback).",
          "tags": ["metriques", "dashboard"], "examples": ["Rapport sur 15 jours"]}],
        {"type": "object", "properties": {
            "from": {"enum": ["agent_calcul", "agent_plan"]},
            "action": {"enum": ["plan_calcule", "plan_justifie", "plan_fallback"]},
            "payload": {"type": "object"}}},
        {"type": "object", "properties": {
            "metriques_energie": {"type": "object"}, "metriques_rag": {"type": "object"},
            "rapport_15_jours": {"type": "object"}}},
        [],
        [{"type": "llm", "name": "Google Gemini", "model": "gemini-2.5-flash"},
         {"type": "http", "name": "MongoDB Atlas Data API", "url": URL_MONGO,
          "optional": False,
          "note": "en cas d'echec : retry x3 avec backoff, puis ecriture locale"}])),
]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CARDS, exist_ok=True)

    print("Workflows Langflow (noeuds existants uniquement) :")
    for fn, filename in (
        (flow_simulateur, "01_Agent_Simulateur.json"),
        (flow_calcul, "02_Agent_Calcul.json"),
        (flow_plan, "03_Agent_Plan.json"),
        (flow_journal, "04_Agent_Journal.json"),
    ):
        fn().dump(filename)

    print("Agent cards (A2A) :")
    for filename, content in CARDS_DEF:
        with open(os.path.join(CARDS, filename), "w", encoding="utf-8") as fh:
            json.dump(content, fh, ensure_ascii=False, indent=2)
        print("  %-28s %d skills" % (filename, len(content["skills"])))
