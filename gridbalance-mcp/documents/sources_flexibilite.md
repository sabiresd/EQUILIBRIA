# Sources de flexibilite et arbitrage de cout

Quand un deficit est detecte (demande > production disponible), le gestionnaire
choisit parmi plusieurs sources la combinaison la moins couteuse qui respecte les
charges protegees.

## Les sources disponibles

| Source | Quand l'utiliser | Limite |
|---|---|---|
| **Batterie** | decharge immediate, le client ne voit rien | capacite et puissance ; ne tient pas un episode sans vent de plusieurs jours |
| **Centrale solaire** | en journee, cout marginal quasi nul | nulle la nuit et par temps couvert |
| **Centrale hydraulique** | montee en puissance rapide | disponibilite du barrage |
| **Centrale thermique (gaz/charbon)** | relais quand le renouvelable ne suffit pas | cout et CO2 eleves |
| **Achat sur le reseau** | import dans la limite de la puissance souscrite | au-dela = depassement penalise |
| **Effacement industriel** | un site accepte de reduire sa conso contre remuneration | volume limite, duree courte |

## La methode d'arbitrage (coeur de la decision)

Pour un besoin donne, comparer les combinaisons possibles et retenir la moins chere.

Exemple — deficit de 31 MW :

- **Option A** : 31 MW reseau -> cout eleve.
- **Option B** : 20 MW batterie + 11 MW reseau -> moins cher.
- **Option C** : 12 MW solaire + 19 MW reseau.
- **Option D** : 20 MW batterie + 8 MW effacement + 3 MW reseau -> **solution optimale**.

La combinaison retenue minimise le cout total tout en couvrant le deficit et en
preservant les charges protegees (hopital, eau). L'ordre de preference par cout
croissant est generalement : decalage de charge / effacement, batterie, solaire,
reseau (dans le plafond), et en dernier recours le depassement penalise.

## Trace de la decision

Chaque action est journalisee : heure, deficit, solution retenue (ex. 20 MW batterie
+ 8 MW effacement + 3 MW reseau), temps de reaction, cout (ex. 340 MAD). Ces donnees
alimentent le tableau de bord, l'audit et la facturation.
