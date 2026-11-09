# Secure Send · Abonnements

App web de gestion des abonnements de Secure Send Group : clients, abonnements, factures mensuelles et rappels WhatsApp.

- Front : HTML/CSS/JS statique, hébergé gratuitement sur GitHub Pages. Installable sur le téléphone (« Ajouter à l'écran d'accueil »).
- Données et connexion : Supabase (plan gratuit), dans le projet partagé avec Boutik Lakay. Les tables de Secure Send sont préfixées `ss_` et protégées par des règles d'accès (RLS) : seuls les comptes inscrits dans `ss_admins` peuvent les lire ou les modifier.
- Les données des clients ne sont **pas** dans ce dépôt.

Note : sur le plan gratuit, Supabase met le projet en pause après 7 jours sans aucune activité. Une utilisation chaque semaine suffit à l'éviter ; sinon, le réactiver depuis supabase.com.

Sauvegarde : Réglages → « Télécharger une sauvegarde » produit un fichier CSV lisible dans Excel ou Google Sheets.
