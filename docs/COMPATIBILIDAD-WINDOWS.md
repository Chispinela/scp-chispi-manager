# Windows compatibility

SCP Chispi Manager targets Windows 10 and Windows 11 x64 on Intel/AMD processors. The installer does not impose a maximum Windows 11 build or a particular Home, Pro, Enterprise, or Education edition. This describes the compatibility policy, not certification of every OS release.

## Implementation

- The installer accepts Windows 10 and later, including Windows 11's internal `10.0` version numbering.
- The interface uses the bundled Electron renderer rather than Windows 11-only window effects.
- Console startup selects modern ConPTY where available and a bundled legacy backend on older Windows 10 builds. If modern initialization fails, it retries the legacy backend with the same executable, arguments, and directory.
- Both console backends are included in the x64 package. Packaged-app users do not need a separate Node.js, Electron, Visual Studio, or Windows Terminal installation.
- Application settings show the intended support and detected OS.

## Game-server requirements

The dedicated server downloaded from Valve has its own requirements, including .NET Framework 4.8, the relevant Visual C++ runtime, sufficient disk space, and RAM/CPU capacity for each instance. The initial project's setup guidance used at least 3 GB RAM and two cores per server; check the current official game requirements before planning capacity.

ARM and 32-bit Windows are outside this package's hosting target. Corporate policies, restricted Windows installations, and S mode can affect whether external desktop software runs.

## What was tested

Historical real execution verified modern, legacy, and fallback console operation on Windows 11 x64, internal version `10.0.26200`.

Automated tests exercise build-selection logic for Windows builds including 10240, 14393, 17763, 18362, 19045, 22000, 22621, 22631, 26100, 26200, and higher values. They do not run the app on each of those systems. Local generated evidence belongs under ignored `output/`, not the public source repository.

A diagnostic from a Windows 11 build 26100 AMD machine showed a stall while creating folders under Documents. Version 1.0.5 isolates folder preparation, bounds it to 30 seconds, and offers an alternative local directory. Controlled recovery tests passed; resolution on that remote computer has not been confirmed.

No accessible Windows 10 machine or complete matrix of Windows 11 installations was available during historical testing. Future Windows updates are not individually certified.

## Component references

- [Electron 44.9.1 platform support](https://github.com/electron/electron/blob/v44.9.1/README.md#platform-support)
- [Node.js 24 platform list](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)
- [node-pty 1.1.0 Windows backend](https://github.com/microsoft/node-pty/blob/1.1.0/src/windowsPtyAgent.ts)
- [Official SCP:SL dedicated server guide](https://techwiki.scpslgame.com/books/server-guides/page/1-how-to-create-a-dedicated-server)
