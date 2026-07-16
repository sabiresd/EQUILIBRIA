"""
Serveur MCP GridBalance (HTTP/SSE) — outils des 4 agents de la chaine A2A.

Meme structure que le dossier MCP (SIH) : importer chaque module enregistre ses
outils sur l'instance `mcp` partagee. Les 4 agents ABA Fusion appellent ces outils.

Agent 1 — Simulateur :
    recuperer_donnees_reseau   (lecture : meteo 360 h temps reel + facture)
    recuperer_facture          (lecture : facture ONEE du site)
Agent 2 — Calcul :
    calculer_dispatch          (calcul : dispatch batterie, deficits, couts)
Agent 3 — Plan :
    rechercher_strategie_rag   (lecture : RAG read-file sur documents/)
    calculer_cout_optimal      (calcul : arbitrage de cout, repli)
Agent 4 — Journal :
    journaliser_decision       (ecriture : SHA-256 + Mongo + e-mail)

Base MongoDB : `gridbalance` (Atlas). Chaque appel est trace dans `mcp_journal`.

Lancement :
    python mcp_server.py
Le serveur ecoute sur http://127.0.0.1:8100 (endpoint SSE : /sse). Dans ABA Fusion,
ajoutez un noeud MCP pointant sur cette adresse, comme pour le MCP Supabase.
"""

from mongo_mcp import mcp

# L'import enregistre les outils sur `mcp`.
import outil_simulateur  # noqa: F401  (Agent 1)
import outil_calcul  # noqa: F401       (Agent 2)
import outil_plan  # noqa: F401         (Agent 3)
import outil_slack  # noqa: F401        (Agent 3 - HITL Slack)
import outil_journal  # noqa: F401      (Agent 4)
import outil_rapport  # noqa: F401      (Agent 4 - PDF + Gmail + DB)

if __name__ == "__main__":
    mcp.run(transport="sse")
