# Arbitrage economique des sources (document de demonstration)

Quand aucune strategie documentee ne couvre le cas, choisir la source la MOINS
couteuse par MWh manquant, parmi :

- **Batterie** : cout = cout d'usure (degradation) par MWh decharge. Interessante
  seulement si le SoC le permet et si l'usure coute moins que le tarif reseau de
  l'heure. Limitee par la puissance et la capacite : ne couvre pas un episode sans
  vent de plusieurs jours.

- **Reseau (dans le plafond souscrit)** : cout = tarif ONEE de l'heure (creuse 0,65 /
  normale 0,90 / pointe 1,40 MAD/kWh). Disponible mais plafonne a la puissance
  souscrite.

- **Depassement reseau** : au-dela du plafond, penalite de depassement. A eviter.

- **Photovoltaique additionnel** : cout marginal quasi nul en journee, mais nul la
  nuit et les jours couverts. N'aide pas sur un deficit nocturne.

## Methode

Pour chaque heure en deficit, estimer le cout de chaque source disponible et retenir
la combinaison la moins couteuse qui respecte les charges protegees. Sommer sur la
fenetre de deficit pour obtenir le cout total du plan.
