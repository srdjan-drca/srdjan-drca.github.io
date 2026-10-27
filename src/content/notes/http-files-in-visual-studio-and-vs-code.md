---
title: ".http files: testing your API without leaving Visual Studio or VS Code"
description: "What a .http file is, how Visual Studio and VS Code run the requests in it, and how I use variables, environments and chained requests to test an API from the IDE."
pubDatetime: 2026-10-27T09:00:00Z
tags:
  - visual-studio
  - vs-code
  - aspnetcore
  - testing
draft: false
---

When I created a new ASP.NET Core Web API project, there was a file next to `Program.cs` that I ignored for months: `MyApi.http`. I kept switching to Postman to call my endpoints. It turns out that file does exactly what Postman did for me, it lives in the repo, and I never have to leave the IDE.

## What a .http file is

A `.http` file is a plain-text file containing one or more HTTP requests, written almost exactly as they go over the wire: method, URL, headers, a blank line, then the body. The editor puts a **Send request** link above each request, and when you click it the response (status, headers, body, timing) opens in a pane next to the file.

```http file="MyApi.http"
@MyApi_HostAddress = https://localhost:7080

GET {{MyApi_HostAddress}}/weatherforecast/
Accept: application/json

###

POST {{MyApi_HostAddress}}/todos
Content-Type: application/json

{
  "title": "Write a note about .http files",
  "isDone": false
}
```

The basic syntax:

| Syntax | Meaning |
| --- | --- |
| `###` | Separates requests. Everything between two separators is one request. |
| `METHOD URL` | First line of a request. `GET` is the default if you leave the method out. |
| `Header: value` | Headers go directly under the request line, one per line. |
| *blank line* + body | Everything after the first empty line is the request body. |
| `@name = value` | Defines a variable for the file. |
| `{{name}}` | Uses a variable (in the URL, headers or body). |
| `#` or `//` | Comments. |

Because it is just text, the file goes into git with the code, shows up in code review, and every developer gets the same set of ready-made requests when they clone the repo.

## Running it in Visual Studio

Visual Studio 2022 (17.6 and later) has a built-in HTTP editor, so there is nothing to install.

1. Start the API (F5 or Ctrl+F5) so something is listening on the URL in your variable.
2. Open the `.http` file and click **▶ Send request** above a request.
3. The response appears in a pane on the right, with tabs for the body, headers and request details.

The ASP.NET Core **Web API** template creates `<ProjectName>.http` with a `@<ProjectName>_HostAddress` variable that matches the URL in [launch profiles](/notes/visual-studio-launch-profiles/). To add a file to an existing project: **Add → New Item → HTTP File**.

The feature I like most is the **Endpoints Explorer** (**View → Other Windows → Endpoints Explorer**). It lists every endpoint in the project, and right-clicking one and choosing **Generate Request** writes a request for it into the `.http` file. That saves a lot of typing on a big controller.

## Running it in VS Code

VS Code has no built-in support. Install the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension (by Huachao Mao). It understands the same syntax, for files ending in `.http` or `.rest`.

- Click **Send Request** above a request, or put the cursor inside it and press **Ctrl+Alt+R**.
- The response opens in a new tab beside the editor.
- **Ctrl+Alt+H** shows the history of requests you have sent.

So the same `.http` file in the repo works for the teammate on Visual Studio and the one on VS Code. Only the environment configuration differs (see below).

## Making it useful for testing

A list of hard-coded requests gets tedious quickly. Three features turn the file into a real manual test suite.

### 1. Environments

Instead of editing the host and keys every time, define environments and switch between them.

**Visual Studio** reads `http-client.env.json` from the folder of the `.http` file (or any parent folder):

```json file="http-client.env.json"
{
  "$shared": {
    "apiVersion": "v1"
  },
  "local": {
    "HostAddress": "https://localhost:7080"
  },
  "staging": {
    "HostAddress": "https://staging.example.com"
  }
}
```

Pick the environment from the dropdown in the top-right corner of the HTTP editor. Values in `$shared` are available in every environment. Put secrets in `http-client.env.json.user` instead, which has the same format, overrides the main file, and should be in `.gitignore`.

**VS Code (REST Client)** keeps environments in `settings.json` (workspace settings, `.vscode/settings.json`, is a good place):

```json file=".vscode/settings.json"
{
  "rest-client.environmentVariables": {
    "$shared": {
      "apiVersion": "v1"
    },
    "local": {
      "HostAddress": "https://localhost:7080"
    },
    "staging": {
      "HostAddress": "https://staging.example.com"
    }
  }
}
```

Switch with **Ctrl+Alt+E** or by clicking the environment name in the status bar.

In both cases the request just uses `{{HostAddress}}`. A variable defined with `@` in the file wins over the environment, so remove `@HostAddress = ...` from the file once you move it into an environment.

### 2. Chaining requests

The typical test flow is "log in, then call something with the token". Name a request with `# @name`, then reference its response in later requests:

```http file="MyApi.http"
# @name login
POST {{HostAddress}}/auth/login
Content-Type: application/json

{
  "username": "test-user",
  "password": "{{TestPassword}}"
}

###

GET {{HostAddress}}/todos
Authorization: Bearer {{login.response.body.$.token}}  // [!code highlight]
```

`$.token` is a JSONPath into the response body. Send `login` first, then the second request picks up the token automatically. You can also read headers, for example `{{login.response.headers.Location}}`. This works in REST Client and in Visual Studio 17.12 and later.

### 3. Dynamic values

To avoid "this name already exists" errors when you send the same `POST` twice, generate values on the fly:

```http
POST {{HostAddress}}/todos
Content-Type: application/json

{
  "title": "Todo {{$randomInt 1 10000}}",
  "createdAt": "{{$datetime iso8601}}"
}
```

Both editors support `$randomInt`, `$datetime`, `$localDatetime` and `$timestamp`. REST Client adds a few more, such as `$guid`.

## How I use it day to day

1. **One `.http` file per API project**, grouped by feature with `###` and a comment heading for each group.
2. **Happy path and edge cases next to each other**: the valid request, then the one with a missing field, then the one without a token. Sending them one after another after a change is a quick smoke test.
3. **Reproducing bugs**: when someone reports a failing call, I paste it into the file as a new request. Set a breakpoint, click Send, and I'm debugging the exact request.
4. **Documentation for free**: a new teammate opens the file and sees how every endpoint is meant to be called, with real bodies.

## Gotchas

- **It's manual testing, not automated testing.** Neither Visual Studio nor REST Client lets you write assertions on the response and run the whole file in CI. For regression tests, write integration tests (for example with `WebApplicationFactory`). Treat the `.http` file as your interactive playground.
- **The API has to be running.** "Connection refused" almost always means you forgot to start the app, or the port in the variable doesn't match `launchSettings.json`.
- **Environment files are not shared between editors.** Visual Studio (and JetBrains Rider) read `http-client.env.json`, REST Client reads `settings.json`. The `.http` file itself is portable, the environments are not.
- **Don't commit secrets.** Use `http-client.env.json.user` in Visual Studio. Visual Studio can also read values from ASP.NET Core User Secrets or Azure Key Vault. In VS Code, keep secrets in user settings, or use `{{$dotenv NAME}}` with a git-ignored `.env` file.
- **The blank line matters.** If a request body is ignored or a header shows up in the body, check that there is exactly one empty line between the headers and the body.

## References

- [Use .http files in Visual Studio](https://learn.microsoft.com/aspnet/core/test/http-files)
- [Endpoints Explorer](https://learn.microsoft.com/aspnet/core/test/http-files#use-endpoints-explorer)
- [REST Client extension for VS Code](https://github.com/Huachao/vscode-restclient)
