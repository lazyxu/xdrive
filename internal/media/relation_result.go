package media

func mergeResultRelationEvidence(out *Result, evidence RelationEvidence) {
	if out == nil {
		return
	}
	current, err := DecodeRelationEvidence(out.RelationJSON)
	if err != nil {
		current = RelationEvidence{}
	}
	current.merge(evidence)
	out.RelationJSON = encodeRelationEvidence(current)
}
