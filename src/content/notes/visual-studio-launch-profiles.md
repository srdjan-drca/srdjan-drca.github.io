---
title: "Visual Studio launch profiles: what the dropdown next to ▶ actually does"
description: "How launchSettings.json defines the profiles in Visual Studio's Start dropdown, and how to use them to run your app with different URLs and environments."
pubDatetime: 2026-10-07T09:00:00Z
tags:
  - visual-studio
  - dotnet
  - aspnetcore
draft: false
---

For a long time I treated the dropdown next to the green **▶ Start** button in Visual Studio as noise. It says `https`, `http` or `IIS Express`, and I clicked Start anyway. That dropdown lists your project's **launch profiles**, and once you know where they come from they become very useful.

## Where they appear

- **The Start button dropdown** in the toolbar. Click the small arrow next to ▶ and you see every profile of the current startup project. The one you pick is what F5 (debug) and Ctrl+F5 (run without debugging) use.
- **Debug → _&lt;Project&gt;_ Debug Properties** opens the *Launch Profiles* window, a UI for creating, renaming and editing profiles.

Your selection is remembered per user in the `.csproj.user` file (`<ActiveDebugProfile>`), so it doesn't end up in your teammates' Visual Studio.

## Where they are configured

Every profile lives in `Properties/launchSettings.json` inside the project. The Launch Profiles window is just an editor for this file. Here is a trimmed version of what the ASP.NET Core template creates, plus a custom `Staging` profile I added:

```jsonc file="Properties/launchSettings.json"
{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "http": {
      "commandName": "Project",
      "launchBrowser": true,
      "applicationUrl": "http://localhost:5080",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    },
    "https": {
      "commandName": "Project",
      "launchBrowser": true,
      "applicationUrl": "https://localhost:7080;http://localhost:5080",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    },
    "Staging": { // [!code highlight:8]
      "commandName": "Project",
      "launchBrowser": false,
      "applicationUrl": "https://localhost:7090",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Staging"
      }
    }
  }
}
```

The properties I actually use:

| Property | What it does |
| --- | --- |
| `commandName` | **How** the app is started: `Project` (run the project itself, using Kestrel for web apps), `IISExpress`, `Executable` (start some other `.exe`), `Docker`, … |
| `applicationUrl` | The URL(s) the app listens on. Separate multiple values with `;`. |
| `environmentVariables` | Set for the process only. `ASPNETCORE_ENVIRONMENT` (or `DOTNET_ENVIRONMENT`) decides which `appsettings.{Environment}.json` is loaded. |
| `launchBrowser` / `launchUrl` | Whether to open a browser, and at which relative path. |
| `commandLineArgs` | Arguments passed to your app, handy for console apps and workers. |

Save the file and the new profile shows up in the Start dropdown right away.

## How I use them when running the solution

1. **Pick the profile, then press F5.** For example, switch to `Staging` to check that `appsettings.Staging.json` is picked up correctly, without touching any config files.
2. **Use one profile per scenario, not per developer.** For example: `https` for normal work, `Staging` for checking environment-specific config, and a profile with `commandLineArgs` for a one-off job.
3. **The CLI reads the same file.** `dotnet run` uses the first profile with `"commandName": "Project"`. To choose one explicitly:

```bash
dotnet run --launch-profile Staging
dotnet run --no-launch-profile   # ignore launchSettings.json entirely
```

Rider and VS Code (C# Dev Kit) read `launchSettings.json` too, so the profiles work for everyone on the team regardless of IDE.

## Gotchas

- **Local development only.** `launchSettings.json` is not used when the app is published or deployed. Production environment variables have to come from the host (App Service, ECS task definition, Lambda configuration, …).
- **Don't put secrets in it.** The file is usually committed to git. Use [User Secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) for local credentials.
- **The profile belongs to the startup project.** In a solution with several projects, the dropdown shows the profiles of whichever project is currently set as startup.

## References

- [Use multiple environments in ASP.NET Core (launchSettings.json)](https://learn.microsoft.com/aspnet/core/fundamentals/environments)
- [`dotnet run` and `--launch-profile`](https://learn.microsoft.com/dotnet/core/tools/dotnet-run)
