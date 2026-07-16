# Equite entre sites — rotation du delestage (document de demonstration)

## Principe d'equite

Quand plusieurs sites de meme priorite peuvent etre delestes, le choix ne doit pas
toujours retomber sur les memes. Un plan de reequilibrage est evalue non seulement
sur son cout, mais sur son **score d'equite** (repartition de l'effort).

## Regle de rotation

Un site ayant subi un delestage au cours des **24 heures glissantes** est exclu du
tour suivant tant qu'un autre site de meme priorite n'a pas ete sollicite. Cela evite
qu'un meme site supporte tout l'effort.

## Score d'equite

- **Faible (< 0,5)** : l'effort pese sur un ou deux sites. Plan economique mais
  inequitable.
- **Eleve (> 0,9)** : l'effort tourne entre les sites. Plus juste, parfois un peu
  plus couteux.

## Arbitrage

Presenter au decideur humain (HITL) au moins deux plans : un moins-disant economique
et un a equite maximale. La decision finale, avec son motif, revient au superviseur.
Les charges protegees restent exclues dans tous les cas.
