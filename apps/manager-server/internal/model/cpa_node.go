package model

// CPANode describes one managed CPA upstream node.
type CPANode struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	BaseURL          string `json:"baseUrl"`
	ManagementKey    string `json:"managementKey,omitempty"`
	Enabled          bool   `json:"enabled"`
	Description      string `json:"description,omitempty"`
	CollectorEnabled bool   `json:"collectorEnabled"`
	CollectorMode    string `json:"collectorMode,omitempty"`
	Queue            string `json:"queue,omitempty"`
	PopSide          string `json:"popSide,omitempty"`
	BatchSize        int    `json:"batchSize,omitempty"`
	PollIntervalMS   int    `json:"pollIntervalMs,omitempty"`
	QueryLimit       int    `json:"queryLimit,omitempty"`
	TLSSkipVerify    bool   `json:"tlsSkipVerify,omitempty"`
	CreatedAtMS      int64  `json:"createdAtMs,omitempty"`
	UpdatedAtMS      int64  `json:"updatedAtMs,omitempty"`
}
