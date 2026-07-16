"""
Module partage : instance MCP + connexion MongoDB (GridBalance).

Meme pattern que le dossier MCP (SIH pharma) : tous les outils importent `mcp` et
`get_collection()` depuis ici. Base = `gridbalance` sur le meme cluster Atlas.

Collections lues/ecrites par les outils :
    weather      (6575 heures NASA 2023 ; source du flux temps reel)
    sim_clock    (pointeur d'horloge partage avec le dashboard)
    runs         (runs orchestres par le backend)
    decisions    (cartes de decision journalisees par l'agent Journal)
    mcp_journal  (trace des appels d'outils)

La connexion est lue depuis MONGODB_URI (sinon la valeur par defaut, le meme
cluster que le projet SIH). Sur Windows, certifi est indispensable pour Atlas.
"""

import os
import sys
from pathlib import Path

import certifi
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pymongo import MongoClient

load_dotenv()

# Le moteur metier (formules (6)-(8), dispatch, facture) vit a la racine du depot.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# L'URI vient du .env (jamais committe). Placeholder par defaut : pas de secret ici.
MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?appName=Cluster0",
)
DB_NAME = os.environ.get("MONGODB_DB", "gridbalance")

mcp = FastMCP(
    "GridBalance_MCP",
    host=os.environ.get("MCP_HOST", "127.0.0.1"),
    port=int(os.environ.get("MCP_PORT", "8100")),
)

_client = None


def get_db():
    """Base MongoDB `gridbalance` (client cree paresseusement, certifi pour Atlas)."""
    global _client
    if _client is None:
        _client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            tlsCAFile=certifi.where(),
        )
    return _client[DB_NAME]


def get_collection(nom: str):
    return get_db()[nom]
