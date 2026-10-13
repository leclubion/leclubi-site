/* Réglages du jeu "Bataille de colonnes" – c'est le SEUL fichier à modifier après la mise en ligne du serveur.
   Il est lu par la page du jeu (jeu.html) et par le site (index.html, onglet Classement). */
window.JEU_CONFIG = {
  // Adresse du serveur du jeu, donnée par Cloudflare (ex. "https://leclubi-jeu.TONPSEUDO.workers.dev"). Sans "/" à la fin.
  API_URL: "leclubi-jeu.leclubi-contact.workers.dev",
  // "Client ID" de l'application Twitch (dev.twitch.tv/console)
  TWITCH_CLIENT_ID: "pni8o966uqya6ibpyr49pai34ai6ce",
  // false = le jeu est en test (aucun lien sur le site, seul toi connais l'adresse). true = le bouton "Jouer" apparaît sur le site.
  OUVERT: true,
   NOM: "Clubi Card Battle"
   CARTES_SOURCE: "tableur"
};
