package issueimport

func init() {
	Register(GitHubHost{})
	Register(GiteeHost{})
	Register(LinearHost{})
}
