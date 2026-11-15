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

    /// <summary>
    /// Loads a JSON list; on deserialization failure the corrupt file is
    /// QUARANTINED (renamed .corrupt-{timestamp}) instead of being left in
    /// place — previously a truncated write made the next Save overwrite the
    /// user's entire annotation/note/bookmark history with an empty list.
    /// </summary>
    private List<T> LoadListOrQuarantine<T>(string path) where T : class
    {
        try
        {
            if (!File.Exists(path)) return new List<T>();
            return JsonSerializer.Deserialize<List<T>>(File.ReadAllText(path), Json) ?? new List<T>();
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException)
        {
            try
            {
                var quarantine = $"{path}.corrupt-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
                File.Move(path, quarantine);
                File.AppendAllText(Path.Combine(Root, "persistence.log"),
                    $"{DateTime.UtcNow:O} quarantined corrupt {Path.GetFileName(path)}: {ex.Message}{Environment.NewLine}");
            }
            catch { /* quarantine best-effort; still return empty */ }
            return new List<T>();
        }
        catch
        {
            // IO errors (locked/missing) — return empty but keep the file.
            return new List<T>();
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
        WriteGuarded(() => WriteAllTextAtomic(AnnotationsPath, JsonSerializer.Serialize(annotations, Json)));

    public List<Annotation> LoadAnnotations() => LoadListOrQuarantine<Annotation>(AnnotationsPath);

    // --- Notes --------------------------------------------------------------

    private string NotesPath => Path.Combine(Root, "notes.json");

    public void SaveNotes(IReadOnlyList<Note> notes) =>
        WriteGuarded(() => WriteAllTextAtomic(NotesPath, JsonSerializer.Serialize(notes, Json)));

    public List<Note> LoadNotes() => LoadListOrQuarantine<Note>(NotesPath);

    // --- Bookmarks ----------------------------------------------------------

    private string BookmarksPath => Path.Combine(Root, "bookmarks.json");

    public void SaveBookmarks(IReadOnlyList<Bookmark> bookmarks) =>
        WriteGuarded(() => WriteAllTextAtomic(BookmarksPath, JsonSerializer.Serialize(bookmarks, Json)));

    public List<Bookmark> LoadBookmarks() => LoadListOrQuarantine<Bookmark>(BookmarksPath);

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
        WriteGuarded(() => WriteAllTextAtomic(SessionPath, JsonSerializer.Serialize(session, Json)));

    /// <summary>Temp-file + move write: a crash mid-write can never truncate the previous file.</summary>
    private void WriteAllTextAtomic(string path, string content)
    {
        var temp = $"{path}.tmp-{Guid.NewGuid():N}";
        File.WriteAllText(temp, content);
        File.Move(temp, path, overwrite: true);
    }

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
