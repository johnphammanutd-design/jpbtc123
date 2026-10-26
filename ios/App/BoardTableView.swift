import SwiftUI

struct BoardTableView: View {
    let snapshot: BoardSnapshot
    let cards: [Record]
    @Binding var ordering: TableOrdering
    var body: some View {
        List {
            Section {
                Picker("Sắp xếp theo", selection: $ordering.key) {
                    ForEach(TableOrdering.Key.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.accessibilityIdentifier("table.sort.key")
                Button { ordering.ascending.toggle() } label: {
                    Label(ordering.ascending ? "Tăng dần" : "Giảm dần", systemImage: ordering.ascending ? "arrow.up" : "arrow.down")
                }.accessibilityLabel("Đổi chiều sắp xếp").accessibilityValue(ordering.ascending ? "Tăng dần" : "Giảm dần").accessibilityIdentifier("table.sort.direction")
            } footer: {
                Text("Chỉ đổi cách xem Bảng kê. Thứ tự thẻ trong Kanban được giữ nguyên. Thẻ chưa đặt hạn luôn ở cuối khi xếp theo hạn.")
            }
            Section("Kết quả · \(cards.count) thẻ") {
                if cards.isEmpty { EmptyState(title: "Không có thẻ khớp bộ lọc") }
                ForEach(ordering.sorted(cards, snapshot: snapshot)) { card in
                    NavigationLink { CardScreen(cardID: card.id) } label: {
                        VStack(alignment: .leading, spacing: 9) {
                            Text(card.title).fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
                            Text(snapshot.lists.first { $0.id == card.number("list_id") }?.title ?? "").font(.caption).foregroundStyle(.secondary)
                            FlowLayout(spacing: 6) { ForEach(snapshot.labels(of: card)) { label in Badge(text: label.text("name").isEmpty ? "Nhãn" : label.text("name"), color: Color(hex: label.text("color"))) } }
                            let names = snapshot.members(of: card).map { $0.text("name") }.joined(separator: ", ")
                            Label(names.isEmpty ? "Chưa giao" : names, systemImage: "person").font(.caption).foregroundStyle(.secondary)
                            if !card.text("due_date").isEmpty { Label(card.text("due_date") + (card.text("due_time").isEmpty ? "" : " · " + card.text("due_time")), systemImage: "clock").font(.caption).foregroundStyle(CompanyClock.overdue(card) ? .red : .secondary) }
                            Badge(text: card.reviewLabel, color: card.flag("due_complete") ? .green : .orange)
                        }.padding(.vertical, 5)
                    }.accessibilityIdentifier("table.card.\(card.id)")
                }
            }
        }.onChange(of: ordering.key) { _, _ in ordering.ascending = true }
    }
}
