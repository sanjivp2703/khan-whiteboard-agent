# Research report — AI coding CLI explanations → narrated whiteboard/explainer video (project `khan`)

Produced by research-agent on 2026-09-26. Problems only; no solutions.

## Internal signals

**No internal data source is configured for this project.** No session replays or customer reviews are connected, so no `[internal signal]` entries appear below. Everything is external inspiration from public sources.

## Caveats on method

- Reddit is blocked from direct fetch in this environment and the search index surfaced almost no threads from r/ClaudeAI, r/ClaudeCode, r/learnprogramming, r/ExperiencedDevs, or r/ChatGPTCoding. Reddit evidence is thin; the bulk comes from GitHub issues on Claude Code / Codex CLI / Gemini CLI, Hacker News threads, and first-hand blog write-ups.
- Several HN threads returned only the top post without comments; they are cited only where comment content was visible.

## Problems (all external inspiration)

### A. Reading long explanations in the terminal

1. `[external inspiration]` **Long responses physically vanish from the terminal before the user can read them.** In Claude Code's TUI, streamed output past the top of the repaint region is overwritten instead of committed to scrollback. "once a response grows taller than the viewport, it becomes impossible to scroll up and read it... I routinely watch an answer stream by and then cannot go back and read what it said." `/export` and env-var opt-outs described as "damage control." Source: anthropics/claude-code #76692 (https://github.com/anthropics/claude-code/issues/76692). Corroborated by #42002, #92678, #85508, #56525, #37389, #82916.

2. `[external inspiration]` **Same failure in competing CLIs: long answers truncated or unreachable.** Codex CLI: "Long assistant responses can exceed the visible terminal viewport, but the TUI does not provide an obvious way to scroll back"; users ask the assistant to write the answer to a file just to read it (openai/codex #23280). Windows Codex loses scrollback (#35335). Gemini CLI "silently truncates the output" (google-gemini/gemini-cli #8156; also #9031, #3428).

3. `[external inspiration]` **Explanations render as raw or flattened markdown, losing structure that aids comprehension.** Claude Code CLI shows "literal markdown characters"; Mermaid/UML diagrams "displayed as raw text"; "no distinction between different text levels." Source: anthropics/claude-code #13600. Codex CLI tables were wrapped plain text until a later fix (https://www.vincentschmalbach.com/codex-cli-responsive-terminal-tables/).

4. `[external inspiration]` **Long sessions are where reading gets hardest; input line moves with every write.** Source: Ship With AI Lab (https://shipwithailab.substack.com/p/claude-code-for-everything-your-terminal).

5. `[external inspiration]` **Verbose narration of reasoning steps is noise that also eats context.** Users add CLAUDE.md directives like "Do not narrate intermediate steps." Sources: https://www.mindstudio.ai/blog/claude-code-token-management-hacks-3; https://dev.to/letanure/claude-code-part-10-common-issues-and-quick-fixes-186g. Blog-level evidence.

### B. Getting the response out of the terminal (sharing, docs, teaching)

6. `[external inspiration]` **Copying a long response out is manual, error-prone, and blocks handoffs.** "manual selection is error-prone, especially for long multi-block answers, frequently missing lines or including UI artifacts"; filed as "Critical - Blocking my work." Source: anthropics/claude-code #48372. Related: #44991, #12927, #5512, #28169, #43856, #30404, #48128. Third-party tools exist just for this (https://github.com/clementrog/claude-copy, https://github.com/Twizzes/copy-claude-response).

7. `[external inspiration]` **Even when copied, the pasted explanation is corrupted: UI glyphs, hard wraps, stripped markdown.** "Every line prefixed with ⏺ or ⎿"; "the markdown syntax is simply gone." Cleanup burden discourages sharing at all. Source: https://trevorfox.com/2026/07/clean-up-claude-code-copy-paste/.

8. `[external inspiration]` **Text explanations of a project get skimmed, not read.** Engagement stayed flat despite solid docs until a video was added. Source: https://dev.to/adamji/stop-writing-walls-of-text-how-ai-whiteboard-videos-made-my-side-project-docs-actually-useful-13fb.

9. `[external inspiration]` **AI-written docs look impressive but are low signal, so readers skim.** HN: "AI written issues, docs, etc look impressive initially but are extremely low signal to noise." Source: https://news.ycombinator.com/item?id=46820924.

### C. Retention and learning-modality pain

10. `[external inspiration]` **Developers who get answers from AI retain measurably less.** Anthropic RCT (52 devs): AI group scored 17% lower (50% vs 67%) on a quiz on concepts used minutes before; those who delegated scored below 40%, those who asked conceptual questions 65%+. Sources: https://www.anthropic.com/research/AI-assistance-coding-skills; https://news.ycombinator.com/item?id=46820924; https://www.devclass.com/ai-ml/2026/02/02/anthropic-research-skilled-devs-make-better-use-of-ai-but-using-ai-is-bad-for-learning-skills/4079561.

11. `[external inspiration]` **"Comprehension debt": teams accept AI code and explanations they cannot later explain.** "no one on the team could explain why design decisions had been made." Source: https://addyosmani.com/blog/comprehension-debt/.

12. `[external inspiration]` **Beginners using agentic CLIs don't understand what was built and depend on repeatedly asking.** Sources: https://lynxcollective.substack.com/p/a-beginners-guide-to-claude-code; https://42futures.substack.com/p/a-vibe-code-review; https://dev.to/mrannedev/my-thoughts-on-vibe-coding-3a2h.

13. `[external inspiration]` **Junior developers gravitate to video for the "big picture" and struggle with dense reference text.** Sources: https://dev.to/sotergreco/coding-tutorials-vs-documentation-which-is-better-for-learning-3nd4; https://dev.to/carlmobiledev/why-video-tutorials-should-not-replace-reading-documentation-5f02/comments.

### D. Demand for visual / video / narrated explanations from AI

14. `[external inspiration]` **Users name "actual visual explainers" as the missing modality in LLM output.** HN on an AI 3blue1brown-style generator: "the one thing that's been missing from all the LLMs: actual visual explainers." Source: https://news.ycombinator.com/item?id=42590290.

15. `[external inspiration]` **Developers already build ad-hoc tooling to turn Claude Code explanations into diagrams/walkthroughs for onboarding.** Walkthrough skill: "a mental model of how something works in under 2 minutes" via clickable Mermaid (https://github.com/alexanderop/walkthrough, https://alexop.dev/posts/building-walkthrough-skill-claude-code/); Mermaid MCP (https://github.com/zabolotiny/mermaid-diagram-claude-code); repo-to-30-second-video (https://github.com/johnpsasser/repo-explainer); NotebookLM-on-repo tutorials (https://medium.com/@kombib/github-to-video-ai-tutorial-2ed4d0480d3b).

16. `[external inspiration]` **Interactive explainers generated with Claude Code impress on visuals but fail on correctness; author did not verify most.** "I've tried the other examples and none of them work"; "sometimes the information is correct!" Source: https://news.ycombinator.com/item?id=47058080.

### E. Complaints about existing AI explainer-video tools

17. `[external inspiration]` **AI-generated Manim videos are superficial, sometimes wrong, and stop early.** "very superficial and often wrong or at least misleading"; "stopped about 1% into the explanation"; "ending after 30s when it needs to go another 1-2 minutes" with overlapping text; "will happily explain non existing concepts." Source: https://news.ycombinator.com/item?id=42590290.

18. `[external inspiration]` **Layout failures in LLM-generated animations: overlapping text, arrows pointing at nothing, deprecated APIs, days of iteration.** Sources: https://towardsai.com/p/l/ai-generated-animations-are-here-almost; https://news.ycombinator.com/item?id=44994071 (Grant Sanderson found LLM manim results "unimpressive"; VLM review loops "don't help much").

19. `[external inspiration]` **NotebookLM Video Overviews are "dull PowerPoint," visually thin, sometimes wrong imagery.** "the AI equivalent of dry toast"; "the visuals actually made the discussion... less interesting than just listening to the narrator"; "misleading AI-generated images of faculty members"; transitions "a bit fast"; generation slower than audio. Sources: https://www.techradar.com/ai-platforms-assistants/gemini/i-tried-using-notebooklms-new-ai-video-overviews-and-ended-up-with-some-usefully-informative-but-rather-dull-powerpoint-presentations; https://wondertools.substack.com/p/notebooklm-the-complete-guide; https://alperenzekigokmen.substack.com/p/thinking-in-public-issue-12-i-tested; https://aigoestocollege.substack.com/p/notebooklm-gets-even-better-video.

20. `[external inspiration]` **NotebookLM Audio Overviews: convincing podcast affect, superficial content, chatter tires technical listeners.** "smarmy Sunday-morning talk show conversation, with over-exaggerated affect and no content"; "the chatty podcasty gab gets tiring." Source: https://news.ycombinator.com/item?id=41693087. For repos: 8-15 minutes for large projects, "cannot replace in-depth code analysis" (https://medium.com/@kombib/github-to-video-ai-tutorial-2ed4d0480d3b).

21. `[external inspiration]` **Synthetic narration described as robotic and monotone.** Synthesia reviews (https://aws.amazon.com/marketplace/reviews/reviews-list/prodview-4gualii44yjze). Enterprise-tool reviews; weak signal for this audience.

## Gaps

- No retrievable first-person Reddit threads from the named subreddits. A human with browser access should search r/ClaudeAI / r/ClaudeCode for "scrollback", "explain", "video", and r/notebooklm for "video overview".
- No direct evidence of developers asking specifically for "Khan Academy style" narrated whiteboard output from a coding CLI; closest signals are items 14, 15, 20.
- No evidence on cost complaints for AI explainer-video generation in developer communities.
