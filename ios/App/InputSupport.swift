import SwiftUI

struct InputSupport: ViewModifier {
    func body(content: Content) -> some View {
        content.scrollDismissesKeyboard(.interactively).toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } label: {
                    Label("Ẩn bàn phím", systemImage: "keyboard.chevron.compact.down")
                }.accessibilityIdentifier("keyboard.dismiss")
            }
        }
    }
}
extension View { func inputSupport() -> some View { modifier(InputSupport()) } }

struct OptionalDateField: View {
    let label: String
    @Binding var value: String
    var required = false
    var body: some View {
        if !required { Toggle(label, isOn: Binding(get: { !value.isEmpty }, set: { value = $0 ? CompanyClock.day(Date()) : "" })) }
        if required || !value.isEmpty {
            DatePicker("Chọn ngày", selection: Binding(get: { CompanyClock.date(value) ?? Date() }, set: { value = CompanyClock.day($0) }), displayedComponents: .date)
                .accessibilityLabel(label)
        }
    }
}
struct OptionalTimeField: View {
    let label: String
    @Binding var value: String
    var body: some View {
        Toggle(label, isOn: Binding(get: { !value.isEmpty }, set: { value = $0 ? "17:00" : "" }))
        if !value.isEmpty {
            DatePicker("Chọn giờ", selection: Binding(get: { CompanyClock.wallTime(value) ?? Date() }, set: { value = CompanyClock.time($0) }), displayedComponents: .hourAndMinute)
                .accessibilityLabel(label)
        }
    }
}

/// Wrap chips and small actions instead of truncating them at larger text sizes.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width ?? .infinity, subviews: subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangement(width: bounds.width, subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: ProposedViewSize(width: min(subviews[index].sizeThatFits(.unspecified).width, bounds.width), height: nil))
        }
    }
    private func arrangement(width: CGFloat, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, usedWidth: CGFloat = 0
        var points: [CGPoint] = []
        for view in subviews {
            let ideal = view.sizeThatFits(.unspecified)
            let size = view.sizeThatFits(ProposedViewSize(width: min(ideal.width, width), height: nil))
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y)); usedWidth = max(usedWidth, x + size.width)
            rowHeight = max(rowHeight, size.height); x += size.width + spacing
        }
        return (CGSize(width: usedWidth, height: y + rowHeight), points)
    }
}
