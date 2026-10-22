package api

// The actual authorized Baidu provider must see the independently hosted
// child serviceHost origin, not the Gallery's trusted UI document.
// Legacy synthetic offline tests still exercise the older source-reviewed
// origin path when no child is configured, but HTTP endpoints fail closed.
func (s *Server) baiduJSAPI4ResourceOrigin() string {
	if s == nil {
		return ""
	}
	if child := s.approvedBaiduIsolatedChildOrigin(); child != "" {
		return child
	}
	return s.AllowedOrigin
}
