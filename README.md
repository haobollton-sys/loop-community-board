# LOOP — Community Board

Projet de forum communautaire en français, avec identité visuelle personnalisée, inspiré du style sombre/minimaliste d'un board communautaire. Ce projet n'est pas une copie exacte des ressources, du code ou de la marque Weazeln : il fournit une base originale à personnaliser.

## Fonctionnalités incluses

- Interface responsive (ordinateur, tablette, mobile).
- Comptes : inscription, connexion, déconnexion, mots de passe hachés avec bcrypt.
- Catégories, recherche, discussions, réponses.
- Suppression de ses propres sujets.
- Signalements et routes de modération réservées aux administrateurs.
- Sessions persistées dans PostgreSQL.
- API JSON et contrôle de saisie côté serveur.

## Prérequis

- Node.js 20 ou plus récent
- Une base PostgreSQL (locale ou hébergée)

## Lancer en local

1. Installe Node.js.
2. Crée une base PostgreSQL et applique `schema.sql` :
   ```bash
   psql "$DATABASE_URL" -f schema.sql
   ```
3. Copie `.env.example` vers `.env` et renseigne `DATABASE_URL` ainsi qu'un `SESSION_SECRET` long et aléatoire.
4. Installe les dépendances et démarre :
   ```bash
   npm install
   npm run dev
   ```
5. Ouvre `http://localhost:3000`.

## Créer le premier administrateur

Crée un compte via l'interface, puis exécute dans PostgreSQL :
```sql
UPDATE users SET role = 'admin' WHERE username = 'TON_PSEUDO';
```
Remplace `TON_PSEUDO` par le pseudo exact du compte. Ne donne le rôle admin qu'à une personne de confiance.

## Déploiement en ligne (exemple : Render)

1. Crée un dépôt Git privé et envoie-y les fichiers du projet.
2. Crée une base PostgreSQL hébergée et applique `schema.sql` à cette base.
3. Crée un service Web Node sur Render lié au dépôt.
4. Build command : `npm install`
5. Start command : `npm start`
6. Variables d'environnement du service :
   - `NODE_ENV=production`
   - `DATABASE_URL` : URL interne de la base PostgreSQL si disponible
   - `SESSION_SECRET` : secret long et aléatoire
   - `TRUST_PROXY=true` si le service est derrière le proxy HTTPS du fournisseur
7. Active HTTPS et vérifie `/api/health`.

Le code s'attend à ce que le schéma SQL soit appliqué à la base avant le premier lancement. La mise en ligne n'est pas faite automatiquement par la génération de ces fichiers : il faut créer les services et configurer le compte d'hébergement.

## Avant ouverture publique

Cette base est un starter, pas encore un service audité pour une grosse communauté. À faire avant lancement public : limitation de débit sur connexion/inscription, vérification d'e-mail et récupération de compte, politique de confidentialité/CGU, anti-spam, protection CSRF adaptée, procédure de sauvegarde/restauration PostgreSQL, journalisation de modération et tests de charge. Prévoir aussi une politique de conservation et suppression des données.

## Personnaliser la marque

Le nom provisoire est **LOOP**. Modifie le titre et les textes dans `public/index.html`, puis les couleurs CSS déclarées dans `public/styles.css` (`--bg`, `--panel`, `--lime`). Vérifie que le nom et le logo choisis sont disponibles avant publication.
