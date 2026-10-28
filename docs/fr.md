# Hildebrand Glow (DCC)

## Présentation

Cette intégration amène vos **compteurs communicants britanniques** (SMETS2, et SMETS1 passés au DCC) dans Gladys, via **Glowmarkt**, le cloud de Hildebrand derrière l’application gratuite **Bright**. Seul votre compte Bright est nécessaire : aucun matériel en plus.

- Un appareil Gladys par **compteur**, électricité et gaz : énergie et coût d’aujourd’hui et d’hier, prix du kWh et abonnement, et la puissance instantanée si vous possédez un afficheur Glow (IHD ou CAD).
- Les **demi-heures d’électricité** arrivent dans les écrans énergie de Gladys à leur heure réelle, même avec plusieurs heures de retard, avec jusqu’à 90 jours d’historique à l’ajout du compteur.
- Des déclencheurs de scène (les chiffres d’hier sont prêts, le tarif change, un compteur n’envoie plus de données puis en envoie de nouveau) et des actions de scène (énergie et coût d’une période, relever maintenant).
- Deux widgets de tableau de bord : un compteur (aujourd’hui, coût, graphique par demi-heure ou par jour) et la connexion.

**Transport : cloud.** Votre compteur envoie ses relevés au DCC (le réseau national des compteurs communicants), Hildebrand les récupère en tant que « DCC Other User », et l’intégration lit le cloud Glowmarkt avec votre compte Bright. Les données arrivent avec **30 minutes à quelques heures de retard** : c’est le fonctionnement du DCC, pas un défaut de l’intégration. Vos données de consommation quittent votre domicile (c’est déjà le cas avec l’application Bright).

Non affiliée à Hildebrand. **Pas encore testée avec un vrai compte Bright** : les requêtes suivent la documentation officielle de Glowmarkt. Merci de signaler ce qui fonctionne et ce qui ne fonctionne pas.

![Illustration générée des widgets : le compteur d’électricité (aujourd’hui, coût, hier, puissance, 24 dernières heures par demi-heure), le compteur de gaz sur 30 jours, et la connexion avec les tarifs — pas une capture d’écran](https://raw.githubusercontent.com/William-De71/gladys-hildebrand-glow/main/docs/assets/widgets.fr.png)

## Prérequis

- Gladys Assistant **5.3.0** ou plus récent.
- Un compteur communicant sur le **DCC** : tous les compteurs SMETS2, et les SMETS1 déjà migrés (demandez à votre fournisseur en cas de doute).
- L’application gratuite **Bright** (Hildebrand, Android ou iOS) : créez un compte, reliez vos compteurs et attendez que votre consommation apparaisse dans l’application. Si les données sont fausses dans Bright, elles le seront aussi dans Gladys : c’est à votre fournisseur de corriger ce qu’il transmet au DCC.
- Facultatif : un **afficheur Glow** (IHD ou CAD) pour la puissance instantanée. Sans lui, Hildebrand n’a pas de puissance instantanée, seulement les demi-heures.

## Configuration

Dans Gladys, ouvrez **Intégrations → Hildebrand Glow (DCC)** :

| Champ                           | Description                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| E-mail du compte Bright         | L’e-mail avec lequel vous vous connectez à l’application Bright.                                            |
| Mot de passe                    | Le mot de passe du compte Bright : envoyé à Hildebrand uniquement, jamais réaffiché ni journalisé.          |
| Relevé des demi-heures          | Toutes les 30 minutes (par défaut) ou 60 minutes. Les compteurs envoient leur consommation par demi-heure.  |
| Relevé de la puissance          | Toutes les 1, 2 (par défaut), 5 ou 10 minutes, uniquement avec un afficheur Glow.                           |
| Historique transmis à Gladys    | 0, 7, 31 (par défaut) ou 90 jours de demi-heures, relevés une fois à l’ajout d’un compteur.                 |
| Demander les dernières données  | Activé par défaut : à chaque demi-heure, demande à Hildebrand d’aller chercher les derniers relevés au DCC. |
| Langue des textes des appareils | Noms des compteurs et des fonctionnalités, messages du bouton ; automatique par défaut.                     |

Cliquez sur **Tester la connexion** : l’intégration se connecte, relève vos compteurs, leur tarif et leurs demi-heures, puis les liste avec l’heure de leurs dernières données. Ouvrez ensuite l’onglet **Découverte** et ajoutez les compteurs voulus : rien n’est créé sans vous.

## Utilisation

### Appareils

| Fonctionnalité             | Type Gladys                          | Remarques                                                                                                                       |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Consommation (demi-heures) | Consommation 30 minutes (kWh)        | Électricité uniquement. Chaque demi-heure est placée à son heure réelle ; Gladys calcule son coût avec votre contrat d’énergie. |
| Énergie aujourd’hui / hier | Index aujourd’hui / Index hier (kWh) | Le total des demi-heures reçues ; aujourd’hui augmente au fil des demi-heures arrivées en retard.                               |
| Coût aujourd’hui / hier    | Monnaie (£)                          | Le coût calculé par Bright d’après votre tarif (pence convertis en livres). Seulement si votre compte a un coût.                |
| Prix du kWh                | Monnaie (£)                          | Le prix d’un kWh connu de Bright, par exemple 0,245 £. Relevé toutes les 6 heures.                                              |
| Abonnement (par jour)      | Monnaie (£)                          | L’abonnement journalier connu de Bright, par exemple 0,6012 £.                                                                  |
| Puissance                  | Puissance (W)                        | Électricité, uniquement avec un afficheur Glow (IHD ou CAD).                                                                    |

Le compteur de gaz n’a pas de consommation par demi-heure dans les écrans énergie de Gladys : Gladys rattache toute consommation au compteur **électrique** principal, le gaz s’ajouterait donc à l’électricité. Son énergie, son coût et son tarif restent des fonctionnalités de l’appareil gaz, et le widget comme l’action de scène donnent son historique. Hildebrand fournit le gaz en kWh (il convertit les m³ du compteur).

### Widgets du tableau de bord

- **Compteur communicant** : l’énergie et le coût d’aujourd’hui, d’hier (ou des 7 / 30 derniers jours), la puissance avec un afficheur Glow, et un graphique en barres des 24 dernières heures par demi-heure, ou des 7 / 30 derniers jours. La légende indique le retard des données. Réglages : le compteur (celui d’électricité par défaut) et le graphique.
- **Hildebrand Glow** : la connexion à Glowmarkt, jusqu’où vont les données de chaque compteur (en orange après 12 heures sans données), les tarifs, les requêtes de la dernière heure, et un bouton **Actualiser** (une fois par 5 minutes).

### Scènes

Déclencheurs (chacun peut être limité à un compteur, ou à l’électricité ou au gaz) :

- **Les chiffres d’hier sont prêts** : une fois par jour et par compteur, quand toutes les demi-heures d’hier sont arrivées, ou à midi avec celles reçues. Variables : jour, énergie (kWh), coût (£), complet.
- **Le tarif d’un compteur change** : le prix du kWh ou l’abonnement connu de Bright a changé. Variables : les nouveaux et les précédents.
- **Un compteur n’envoie plus de données** : aucune nouvelle demi-heure depuis 12 heures (compteur, hub de communication ou DCC muet). **Un compteur envoie de nouveau des données** : les demi-heures reviennent.

Actions :

- **Obtenir l’énergie et le coût d’une période** : aujourd’hui, hier, cette semaine, les 7 derniers jours, ce mois-ci, le mois dernier ou les 30 derniers jours, pour un compteur (celui d’électricité par défaut). Sorties : énergie (kWh), coût (£), jours, complet, premier et dernier jour.
- **Relever les compteurs maintenant** : donne l’énergie et le coût d’aujourd’hui de chaque énergie, et l’heure des dernières données.

Exemples :

- Quand les chiffres d’hier sont prêts → envoyer « Hier : {{triggerEvent.data.energy_kwh}} kWh, {{triggerEvent.data.cost}} £ ».
- Chaque 1er du mois à 10 h → obtenir l’énergie et le coût du mois dernier, puis les envoyer dans une notification.
- Quand un compteur n’envoie plus de données → envoyer « {{triggerEvent.data.device_name}} : aucune donnée depuis {{triggerEvent.data.hours}} h, vérifiez l’application Bright ».

### Transport

Le catalogue affiche le badge **cloud** : chaque requête part vers `api.glowmarkt.com` avec votre compte Bright. Le rythme est léger : un « catchup » par compteur juste après chaque demi-heure (comme le demande la documentation Glowmarkt), les demi-heures relevées 10 minutes plus tard, les compteurs et les tarifs toutes les 6 heures, la puissance seulement avec un afficheur Glow. Si vous avez un afficheur Glow, son flux MQTT local donne une puissance en temps réel que cette intégration ne lit pas.

## Dépannage

- **« Glowmarkt refuse la connexion »** : vérifiez d’abord l’e-mail et le mot de passe dans l’application Bright, puis dans la configuration.
- **Connectée, mais aucun compteur** : vos compteurs n’apparaissent pas encore dans l’application Bright ; reliez-les d’abord là-bas.
- **Les données s’arrêtent depuis des heures** : le DCC livre en retard, parfois beaucoup. Comparez avec l’application Bright au même moment ; si Bright n’a pas de données non plus, le problème vient du compteur ou du fournisseur. Le déclencheur « Un compteur n’envoie plus de données » vous prévient après 12 heures.
- **Aujourd’hui reste bas jusqu’au soir** : les dernières demi-heures arrivent progressivement ; hier est complet une fois toutes ses demi-heures reçues (le déclencheur vous le dit).
- **Pas de puissance** : il faut un afficheur Glow (IHD ou CAD) ; sans lui, Hildebrand n’a pas de puissance instantanée.
- **Pas de coût ni de tarif** : Bright ne connaît pas de tarif pour ce compteur ; l’énergie fonctionne quand même.
- Signalez un problème sur [GitHub](https://github.com/William-De71/gladys-hildebrand-glow/issues) avec votre version de Gladys, la version de l’intégration et le résultat de « Tester la connexion ». Ne collez jamais votre mot de passe.
