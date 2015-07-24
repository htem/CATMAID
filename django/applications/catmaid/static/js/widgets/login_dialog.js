/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

(function(CATMAID) {

    /**
     * Creates a simple login dialog.
     */
    var LoginDialog = function(text, callback) {
      this.dialog = new CATMAID.OptionsDialog("Permission required");
      if (text) {
        this.dialog.appendMessage(text);
      }
      // Add short login text
      var login_text = "Please enter the credentials for a user with the " +
          "necessary credentials to continue to the requested information";
      this.dialog.appendMessage(login_text);
      // Add input fields
      var user_field = this.dialog.appendField('Username', 'username', '', true);
      var pass_field = this.dialog.appendField('Password', 'password', '', true);
      pass_field.setAttribute('type', 'password');
      // Align input fields better
      $(this.dialog.dialog).find('label').css('width', '25%');
      $(this.dialog.dialog).find('label').css('display', 'inline-block');

      // If OK is pressed, the dialog should cause a (re-)login
      this.dialog.onOK = function() {
        login($(user_field).val(), $(pass_field).val(), callback);
      };
    };

    LoginDialog.prototype = {};

    /**
     * Displays the login dialog.
     */
    LoginDialog.prototype.show = function() {
      this.dialog.show('400', 'auto', true);
    };

    // Make dialog available in CATMAID namespace
    CATMAID.LoginDialog = LoginDialog;

})(CATMAID);
