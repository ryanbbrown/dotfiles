---
name: pr
description: Create a pull request summary and opening plan. Use when the user wants a PR draft, PR summary, or help opening a PR.
argument-hint: "[feature-branch] [target-branch] [pr-title]"
---

## Step 1: Create PR Summary
View files that have changed using `git diff [target-branch]..[feature-branch] --name-only` and view the changes themselves using `git diff [target-branch]..[feature-branch]`. The user will provide these branches; first the feature branch name, then the target branch name.

Then, based on those changes create a file `prompts/pr_summary_[date].md` wth the following format:

```
### Summary  
[One-sentence or short paragraph: what was changed and why]

### What Changed  
- [Major change A]  
  - `file1.py`: describe changes
  - `file2.js`: describe changes  
- [Major change B]  
  - `file3.py`: describe changes
  - `file4.js`: describe changes 
- [Major change C]  
  - `file5.py`: describe changes
  - `file6.js`: describe changes 

### Notes  
[Optional: any caveats, follow-up needed, deferred work]
```

Wait for the user to review this summary and confirm.

## Step 2: Create PR
Actually create the PR in Github with the command `gh pr create --base main --head feature-branch --title "[pr-title]" --body-file prompts/pr_summary.md`.

ALWAYS ask the user for permission to run this command, even if you're in dangerously-skip-permissions mode.
