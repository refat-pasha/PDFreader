using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PDFreader.App;

public partial class PasswordDialog : Window
{
    public string PasswordValue { get; private set; } = "";

    public PasswordDialog(string filePath, bool incorrect)
    {
        InitializeComponent();
        FileNameText.Text = System.IO.Path.GetFileName(filePath);
        ErrorText.Visibility = incorrect ? Visibility.Visible : Visibility.Collapsed;
        Loaded += (_, _) => { PasswordBox.Focus(); };
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        PasswordValue = PasswordBox.Password;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
