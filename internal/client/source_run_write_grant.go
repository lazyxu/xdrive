package client

import (
 "context"
 "fmt"
 "net/http"
 "time"
)

// SourceRunWriteGrant is an exact run-bound bearer for authenticated
// source-agent file ingestion. It is never returned to a browser renderer.
type SourceRunWriteGrant struct {
 AccessToken string `json:"access_token"`
 ExpiresAt time.Time `json:"expires_at"`
}

func (c *Client) SourceRunWriteGrant(ctx context.Context, sourceID uint64, runID string) (SourceRunWriteGrant,error) {
 var grant SourceRunWriteGrant
 if c==nil || sourceID==0 || runID=="" {return grant,fmt.Errorf("invalid SourceRun grant request")}
 err:=c.json(ctx,http.MethodPost,fmt.Sprintf(
  "/api/v1/sources/%d/runs/%s/write-grant",sourceID,runID,
 ),struct{}{},&grant)
 if err!=nil {return SourceRunWriteGrant{},err}
 if grant.AccessToken=="" || !grant.ExpiresAt.After(time.Now()) {return SourceRunWriteGrant{},fmt.Errorf("invalid SourceRun grant")}
 return grant,nil
}
