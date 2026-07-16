# Processus metier — gestion de flexibilite energetique

Le gestionnaire de flexibilite est la couche de decision au-dessus du SCADA : le
SCADA observe et controle la centrale, le gestionnaire decide comment maintenir
l'equilibre production/demande au moindre cout.

## Les etapes du processus (cible)

1. **Prevision meteo** — vent, direction, temperature a 15 min, 1 h, 6 h, 24 h.
2. **Prevision de production** — transformer la meteo en puissance via la courbe de
   puissance des turbines (voir document methode de prevision).
3. **Reception de la demande** — le besoin des clients (usine, sites).
4. **Calcul offre / demande** — comparer production prevue et consommation prevue.
5. **Surveillance temps reel (SCADA)** — mesures continues : production, disponibilite,
   alarmes, temperatures.
6. **Detection des ecarts** — un evenement `ENERGY_DEFICIT` est cree quand la
   production tombe sous la demande.
7. **Recherche des ressources disponibles** — interroger batterie (SoC, puissance),
   solaire, reseau, effacement industriel.
8. **Optimisation** — chercher la combinaison de ressources la MOINS couteuse qui
   couvre le deficit (voir document arbitrage de cout).
9. **Decision** — retenir la meilleure strategie ; une validation humaine (HITL) peut
   etre requise pour les actions sensibles.
10. **Dispatch** — envoyer les ordres aux ressources (decharge batterie, import reseau,
    effacement...).
11. **Verification et reporting** — le SCADA verifie que l'equilibre est retabli ;
    l'action est journalisee (deficit, solution, temps de reaction, cout).

## Difference AS-IS / TO-BE

- AS-IS : detection APRES coup, analyse humaine, decision operateur, reaction en
  minutes, optimisation des couts limitee.
- TO-BE : deficit ANTICIPE grace aux previsions, decision par l'optimiseur, reaction
  en secondes, optimisation multicritere, apprentissage sur l'historique.

C'est cette separation supervision (SCADA) / decision (gestionnaire IA) qui fait la
valeur du systeme.
