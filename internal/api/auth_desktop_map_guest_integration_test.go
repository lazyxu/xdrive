//go:build linux

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestDesktopMapGuestNativeGrantRealPostgresOwnerReplayAndRevocation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" { t.Skip("isolated PostgreSQL fixture is not configured") }
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.DesktopMapGuestGrant{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB:db, Auth:auth.New("test-desktop-native-map-grant-only", 15*time.Minute),
		RefreshTTL:time.Hour}
	owner := meta.User{Username:"map-native-"+uuid.NewString(), PasswordHash:"synthetic",
		Role:meta.UserRoleUser, SessionVersion:1}
	foreign := meta.User{Username:"map-foreign-"+uuid.NewString(), PasswordHash:"synthetic",
		Role:meta.UserRoleUser, SessionVersion:1}
	for _, u := range []*meta.User{&owner,&foreign} {
		if err := db.Create(u).Error; err != nil {t.Fatal(err)}
	}
	ownerSession, err := s.issueSession(db, owner)
	if err != nil {t.Fatal(err)}
	foreignSession, err := s.issueSession(db, foreign)
	if err != nil {t.Fatal(err)}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v1/auth/desktop-map/issue",s.requireAuth(),s.issueDesktopMapGuestGrant)
	r.POST("/api/v1/auth/desktop-map/redeem",s.redeemDesktopMapGuestGrant)
	const origin = "https://drive.example.test:8443"
	issue := func(bearer, nativeRefresh string) (*httptest.ResponseRecorder,string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"native_refresh_token":nativeRefresh})
		req := httptest.NewRequest(http.MethodPost,origin+"/api/v1/auth/desktop-map/issue",
			strings.NewReader(string(body)))
		req.Header.Set("Content-Type","application/json")
		if bearer != "" {req.Header.Set("Authorization","Bearer "+bearer)}
		w := httptest.NewRecorder()
		r.ServeHTTP(w,req)
		var dto struct { Ticket, Username string; ExpiresIn int64 `json:"expires_in"` }
		_ = json.Unmarshal(w.Body.Bytes(),&dto)
		return w,dto.Ticket
	}
	redeem := func(ticket, host, requestOrigin string) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"ticket":ticket})
		req := httptest.NewRequest(http.MethodPost,host+"/api/v1/auth/desktop-map/redeem",
			strings.NewReader(string(body)))
		req.Header.Set("Origin",requestOrigin)
		req.Header.Set("Sec-Fetch-Site","same-origin")
		req.Header.Set("Content-Type","application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w,req)
		return w
	}
	first,ticket := issue(ownerSession.AccessToken,ownerSession.RefreshToken)
	if first.Code != 200 || len(ticket) != 64 || first.Header().Get("Cache-Control")!="no-store" {
		t.Fatalf("native issue failed %d: %s",first.Code,first.Body.String())
	}
	if len(first.Result().Cookies())!=0 || strings.Contains(first.Body.String(),ownerSession.RefreshToken) {
		t.Fatal("native issue leaked refresh Cookie or native refresh secret")
	}
	// The same correct HTTPS Server cookie exchange is accepted once.
	good := redeem(ticket,origin,origin)
	if good.Code!=200 {t.Fatalf("same Origin redeem=%d: %s",good.Code,good.Body.String())}
	var dto authResponse
	if json.Unmarshal(good.Body.Bytes(),&dto)!=nil || dto.Username!=owner.Username ||
		!dto.BrowserSession || dto.RefreshToken!="" || dto.AccessToken=="" {
		t.Fatal("Native->browser exchange changed the Owner or leaked refresh secret")
	}
	found := false
	for _, cookie := range good.Result().Cookies() {
		if cookie.Name==browserRefreshCookieName {
			found = cookie.Secure && cookie.HttpOnly && cookie.SameSite==http.SameSiteStrictMode
		}
	}
	if !found {t.Fatal("redeem did not issue secure HttpOnly refresh Cookie")}
	if replay:=redeem(ticket,origin,origin);replay.Code!=401 ||
		len(replay.Result().Cookies())!=0 {
		t.Fatal("reused native map ticket gained an additional browser session")
	}
	// A different Host with self-consistent forged Origin is still not the
	// exact HTTPS Host that the native Agent requested its grant for.
	_,wrongHost := issue(ownerSession.AccessToken,ownerSession.RefreshToken)
	if w:=redeem(wrongHost,"https://other.example.test:8443","https://other.example.test:8443");w.Code!=401 {
		t.Fatalf("cross Host exchange status=%d",w.Code)
	}
	if w:=redeem(wrongHost,origin,origin);w.Code!=200 {
		t.Fatalf("proper Origin failed after a rejected cross-Host try: %d",w.Code)
	}
	// A Browser Access JWT from this Owner is insufficient without the
	// native RefreshToken, and a foreign native secret must not be accepted.
	if w,_:=issue(ownerSession.AccessToken,"this-is-not-a-native-refresh-secret");w.Code!=401 {
		t.Fatalf("access-only upgrade status=%d",w.Code)
	}
	if w,_:=issue(ownerSession.AccessToken,foreignSession.RefreshToken);w.Code!=401 {
		t.Fatalf("cross Owner native secret status=%d",w.Code)
	}
	if w,_:=issue(foreignSession.AccessToken,ownerSession.RefreshToken);w.Code!=401 {
		t.Fatalf("foreign Access JWT with Owner native proof status=%d",w.Code)
	}
	// Serial row locking prevents two concurrent requests consuming a ticket.
	_,raceToken:=issue(ownerSession.AccessToken,ownerSession.RefreshToken)
	var wg sync.WaitGroup
	codes:=make([]int,2)
	for i:=0;i<2;i++ {
		wg.Add(1)
		go func(i int){defer wg.Done();codes[i]=redeem(raceToken,origin,origin).Code}(i)
	}
	wg.Wait()
	sort.Ints(codes)
	if codes[0]!=200 || codes[1]!=401 {
		t.Fatalf("one-time map ticket race allowed inconsistent results: %v",codes)
	}
	_,revokedToken:=issue(ownerSession.AccessToken,ownerSession.RefreshToken)
	now:=time.Now().UTC()
	if err:=db.Model(&meta.RefreshToken{}).Where("token_hash = ?",
		auth.HashRefreshToken(ownerSession.RefreshToken)).Update("revoked_at",now).Error;err!=nil {
		t.Fatal(err)
	}
	if w:=redeem(revokedToken,origin,origin);w.Code!=401 {
		t.Fatalf("native logout did not revoke pending map grant: %d",w.Code)
	}
	// A separate currently valid native credential proves expiry, disabled
	// account, session_version and must-change-password are checked at redeem.
	second,err:=s.issueSession(db,owner)
	if err!=nil {t.Fatal(err)}
	_,expiredToken:=issue(second.AccessToken,second.RefreshToken)
	expiredHash,_:=desktopMapGuestTicketHash(expiredToken)
	if err:=db.Model(&meta.DesktopMapGuestGrant{}).Where("hash = ?",expiredHash).
		Update("expires_at",time.Now().Add(-time.Minute)).Error;err!=nil {t.Fatal(err)}
	if w:=redeem(expiredToken,origin,origin);w.Code!=401 {
		t.Fatalf("expired grant redeemed: %d",w.Code)
	}
	_,versionToken:=issue(second.AccessToken,second.RefreshToken)
	if err:=db.Model(&meta.User{}).Where("id = ?",owner.ID).
		Update("session_version",uint64(2)).Error;err!=nil {t.Fatal(err)}
	if w:=redeem(versionToken,origin,origin);w.Code!=401 {
		t.Fatalf("revoked native Owner session redeemed: %d",w.Code)
	}
}
