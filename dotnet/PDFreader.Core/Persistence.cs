using System.IO;
using System.Text.Json;
using PDFreader.Core.Models;

namespace PDFreader.Core;

/// <summary>
/// Local persistence: session state, annotations, notes, bookmarks and recent
/// files are stored as JSON under %LOCALAPPDATA%\PDFreader. Passwords are
/// never persisted.
/// </summary>
public sealed class Persistence
{
    /// <summary>Override for tests; defaults to %LOCALAPPDATA%\PDFreader.</summary>
    public static string? RootOverride { get; set; }

    private static string Root =>
        RootOverride ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PDFreader");

    /// <summary>True once a write has failed; further writes are skipped so a
    /// locked-down data directory never spams the user with error dialogs.</summary>
    public bool StorageDegraded { get; private set; }

    private bool WriteGuarded(Action write)
    {
        if (StorageDegraded) return false;
        try
        {
            Directory.CreateDirectory(Root);
            write();
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            StorageDegraded = true;
            return false;
        }
        catch (IOException)
        {
            StorageDegraded = true;
            return false;
        }
    }

    private T? ReadGuarded<T>(Func<T?> read) where T : class
    {
        try
        {
            return read();
        }
        catch
        {
            return null;
        }
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public string RootDirectory => Root;

    // --- Recent files -------------------------------------------------------

    private string RecentPath => Path.Combine(Root, "recent.json");

    public void SaveRecent(IReadOnlyList<RecentFile> entries) =>
        WriteGuarded(() => File.WriteAllText(RecentPath, JsonSerializer.Serialize(entries.Take(10), Json)));

    public List<RecentFile> LoadRecent()
    {
        try
        {
            if (!File.Exists(RecentPath)) return new List<RecentFile>();
            return JsonSerializer.Deserialize<List<RecentFile>>(File.ReadAllText(RecentPath), Json) ?? new();
        }
        catch
        {
            return new List<RecentFile>();
        }
    }

    // --- Annotations --------------------------------------------------------

    private string AnnotationsPath => Path.Combine(Root, "annotations.json");

    public void SaveAnnotations(IReadOnlyList<Annotation> annotations) =>
        WriteGuarded(() => File.WriteAllText(AnnotationsPath, JsonSerializer.Serialize(annotations, Json)));

    public List<Annotation> LoadAnnotations()
    {
        try
        {
            if (!File.Exists(AnnotationsPath)) return new List<Annotation>();
            return JsonSerializer.Deserialize<List<Annotation>>(File.ReadAllText(AnnotationsPath), Json) ?? new();
        }
        catch
        {
            return new List<Annotation>();
        }
    }

    // --- Notes --------------------------------------------------------------

    private string NotesPath => Path.Combine(Root, "notes.json");

    public void SaveNotes(IReadOnlyList<Note> notes) =>
        WriteGuarded(() => File.WriteAllText(NotesPath, JsonSerializer.Serialize(notes, Json)));

    public List<Note> LoadNotes()
    {
        try
        {
            if (!File.Exists(NotesPath)) return new List<Note>();
            return JsonSerializer.Deserialize<List<Note>>(File.ReadAllText(NotesPath), Json) ?? new();
        }
        catch
        {
            return new List<Note>();
        }
    }

    // --- Bookmarks ----------------------------------------------------------

    private string BookmarksPath => Path.Combine(Root, "bookmarks.json");

    public void SaveBookmarks(IReadOnlyList<Bookmark> bookmarks) =>
        WriteGuarded(() => File.WriteAllText(BookmarksPath, JsonSerializer.Serialize(bookmarks, Json)));

    public List<Bookmark> LoadBookmarks()
    {
        try
        {
            if (!File.Exists(BookmarksPath)) return new List<Bookmark>();
            return JsonSerializer.Deserialize<List<Bookmark>>(File.ReadAllText(BookmarksPath), Json) ?? new();
        }
        catch
        {
            return new List<Bookmark>();
        }
    }

    // --- Session ------------------------------------------------------------

    private string SessionPath => Path.Combine(Root, "session.json");

    public sealed class SessionFile
    {
        public List<string> Paths { get; set; } = new();
        public string? ActivePath { get; set; }
        public Dictionary<string, SessionView> Views { get; set; } = new();
    }

    public sealed class SessionView
    {
        public int Page { get; set; } = 1;
        public double Zoom { get; set; } = 1.0;
        public int Rotation { get; set; }
    }

    public void SaveSession(SessionFile session) =>
        WriteGuarded(() => File.WriteAllText(SessionPath, JsonSerializer.Serialize(session, Json)));

    public SessionFile? LoadSession()
    {
        try
        {
            if (!File.Exists(SessionPath)) return null;
            return JsonSerializer.Deserialize<SessionFile>(File.ReadAllText(SessionPath), Json);
        }
        catch
        {
            return null;
        }
    }
}
