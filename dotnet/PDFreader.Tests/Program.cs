// In-process xUnit console runner. `dotnet exec PDFreader.Tests.dll` (or the
// produced apphost) executes all tests without the vstest testhost, which is
// blocked in restricted job objects. `dotnet test` still works via vstest in CI.
using Xunit;
using Xunit.Abstractions;
using Xunit.Runners;

namespace PDFreader.Tests;

public static class Program
{
    public static int Main(string[] args)
    {
        // Optional render harness mode (kept for debugging PDFium outside WPF).
        if (args.Contains("--render-harness"))
            return RenderHarness.Run(args.Where(a => a != "--render-harness").ToArray());

        var filter = args.FirstOrDefault(a => !a.StartsWith('-'));
        var assemblyPath = typeof(Program).Assembly.Location;
        var controller = new XunitFrontController(
            AppDomainSupport.Denied,
            assemblyPath,
            sourceInformationProvider: null);

        var discovery = new DiscoverySink();
        controller.Find(false, discovery, TestFrameworkOptions.ForDiscovery());
        discovery.Finished.WaitOne(30_000);

        var cases = discovery.TestCases
            .Where(c => filter is null || c.DisplayName.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .ToList();

        var execution = new ExecutionSink();
        controller.RunTests(cases, execution, TestFrameworkOptions.ForExecution());
        execution.Finished.WaitOne(TimeSpan.FromMinutes(10));

        Console.WriteLine();
        Console.WriteLine($"Test run: {cases.Count} | passed: {execution.Passed} | failed: {execution.Failed} | skipped: {execution.Skipped}");
        foreach (var failure in execution.Failures)
            Console.WriteLine(failure);
        return execution.Failed == 0 ? 0 : 1;
    }

    private sealed class DiscoverySink : LongLivedMarshalByRefObject, IMessageSink
    {
        public readonly List<ITestCase> TestCases = new();
        public readonly ManualResetEvent Finished = new(false);

        public bool OnMessage(IMessageSinkMessage message)
        {
            if (message is ITestCaseDiscoveryMessage found)
                TestCases.Add(found.TestCase);
            else if (message is IDiscoveryCompleteMessage)
                Finished.Set();
            return true;
        }

        public void Dispose() { }
    }

    private sealed class ExecutionSink : LongLivedMarshalByRefObject, IMessageSink
    {
        public readonly ManualResetEvent Finished = new(false);
        public int Passed, Failed, Skipped;
        public readonly List<string> Failures = new();

        public bool OnMessage(IMessageSinkMessage message)
        {
            switch (message)
            {
                case ITestPassed passed:
                    Interlocked.Increment(ref Passed);
                    Console.WriteLine($"  PASS {passed.TestCase.DisplayName}");
                    break;
                case ITestFailed failed:
                    Interlocked.Increment(ref Failed);
                    Console.WriteLine($"  FAIL {failed.TestCase.DisplayName}");
                    var reason = failed.Messages is { Length: > 0 } msgs ? string.Join("\n    ", msgs) : string.Empty;
                    var traces = failed.StackTraces is { Length: > 0 } st ? string.Join("\n    ", st) : string.Empty;
                    Failures.Add($"    {reason}\n    {traces}");
                    break;
                case ITestSkipped skipped:
                    Interlocked.Increment(ref Skipped);
                    Console.WriteLine($"  SKIP {skipped.TestCase.DisplayName}");
                    break;
                case ITestAssemblyFinished:
                    Finished.Set();
                    break;
            }
            return true;
        }

        public void Dispose() { }
    }
}
