using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PDFreader.App;

public partial class PasswordDialog
{
    private void Password_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        PasswordValue = PasswordBox.Password;
        DialogResult = true;
    }
}
