# Charges protegees et criticite (document de demonstration)

## Principe

Certaines charges ne peuvent JAMAIS etre delestees, quel que soit le deficit. Leur
interruption mettrait en danger des personnes ou romprait un service vital. Elles
sont verrouillees : aucun plan de reequilibrage ne peut les selectionner.

## Classement des charges du site

| Charge | Criticite | Delestable |
|---|---|---|
| Hopital regional | critique | NON (verrouille) |
| Station de traitement d'eau | haute | NON (verrouille) |
| Site industriel A (process continu) | moyenne | oui, en dernier |
| Site tertiaire B (bureaux) | basse | oui |
| Site industriel C (differable) | moyenne | oui |

## Ordre de delestage

Quand le delestage est inevitable, couper dans cet ordre : confort et eclairage non
essentiel, tertiaire, industrie differable, industrie a process continu. Ne jamais
atteindre les charges verrouillees.

## Regle absolue

Un plan qui delesterait une charge verrouillee est INVALIDE et doit etre rejete a la
validation humaine, meme s'il est le moins couteux.
