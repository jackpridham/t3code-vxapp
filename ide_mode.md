plan out an entirely different approach, maintain the existing layout broken as it is and:

1. Create a new Settings -> Orchestration -> Orchestration -> "Toggle IDE Mode" T/F
2. Where appropriate, detect if IDE mode is enabled/disabled

IDE Mode:

1. Create a new left sidebar component "Explorer Sidebar", the Explorer Sidebar will be similar to vscode explorer sidebar, collapsable list of
   components, toggle Explorer Sidebar with Control Shift + E, this shows and hides the Explorer Sidebar

- Control Shift + C: Changes Panel is expanded, all other items retract
- Control Shift + E: File explorer/navigator is expanded, all other items retract
- Control Shift + T: Active workers and threads are shown for the currently selected project, all other items retract
  -- Active workers are displayed the same way that they are currently with the orchestration sidebar, hardhat and labels inline
- User can then optionally as well expand multiple items within the explorer (as you can with vscode)

2. Create a new Orchestration Sidebar based on the nav sidebar that has been created, copy its functionality exactly apart from the obvious settings,
   artifacts, this new component is called Orchestration Manager: Control ALT M

- Show all of the apps here in the same way that the Artifacts handles displaying the projects, but do not show all of the threads under the projects,
  just show the project
- If workers have been dispatched to this project, just include the yellow hard hat icon next to the projects name, show a maximum of 5 before showing
  text (+ 69 more) (or however many there are)
- If a worker is currently active within the project, place a green blinking dot
- Executive & Orchestrators are shown in their own parent top level item
  -- Labels assigned to them are displayed as children
- Projects that have been created that are not configured within vx or have not been automatically assigned a parent to group under that exist
  -- Create top level nav item: Uncategorized
  --- group all of these as children under uncategorized

3. Currently ChatView appears central, with IDE mode, it is switched and instead the Code Viewer the central component (name this appropriately)

- Handle ability to track the currently selected file based on if it is selected as a file from the changes panel (grouped neat files) vs a selection
  from the file tree
- if no file is selected, just show a blank screen and await for file selecton
- Create a header (same height as ChatView header): IDEHeader

4. Inside IDEHeader, new component, IDEHeaderTitle
   -- Align Left: file name (not full path)
   --- add clipboard icon next to file name that will copy file name to clipboard (again not full path)
   -- Align Right: toggle icons
   --- Toggle Markdown Preview: Control Shift + V
   ---- disable/muted if the file is not .md
   ---- if file is .md, switch from viewing the markdown code to viewing it formatted
   ---- ensure that toggle is fully functional
   --- Toggle diff viewer: Control Shift + D
   ---- By default dont show diff, instead show the exisiting way that the codeviewer handles diff viewing with the neat vertical line on the line number
   -- Create a minimap for the code viewer to align on the right of the code viewer component so the user can easily scroll and navigate the file

5. Inside IDEHeader below title: IDEHeaderBreadcrumbs

- relative path of file, split by / and formatted neatly with the last item being the filename
- ability to right click to copy abs or rel path to clipboard

6. RHS Sidebar: ChatDrawer, ideally abstract some ChatView logic so it can be reused inside of ChatDrawer: Toggle with Control Alt + B

- shows chatview for actively selected thread but inside the new sidebar component.
- move model selection and other item selections into theheader of the ChatDrawer so you can swap and change from there.
- Add dropdown selector so you can select workers from the ChatDrawer as well but scoped to the project/app that is currently being viewed

Notes:

- make it so both the ChatDrawer and Explorer panel can be adjusted width
- Control + E brings up the primary executive thread (in the ChatDrawer)
- Control + O brings up the primary orchestration thread (in the ChatDrawer)

ensure that these changes that you make are all abstracted enough and can be modular and tested and arent tightly coupled.
