import { Column, Row, Text, Button } from "@once-ui-system/core/components";
import "./HeroBanner.scss";

export function HeroBanner() {
  return (
    <div className="ny-hero">
      <div
        className="ny-hero__backdrop"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1925&auto=format&fit=crop')`,
        }}
      />
      <div className="ny-hero__overlay">
        <Column gap="16" padding="32" className="ny-hero__content">
          <span className="ny-hero__badge">NỔI BẬT TRONG NGÀY</span>

          <Text variant="heading-strong-xl" onBackground="neutral-strong">
            Viral Hit - Trận Chiến Cuối Cùng
          </Text>

          <Text
            variant="body-default-m"
            onBackground="neutral-medium"
            className="ny-hero__description"
          >
            Một học sinh trung học bị bắt nạt tình cờ tìm thấy một kênh bí mật
            dạy cách chiến đấu. Cậu quyết định thay đổi cuộc đời mình và trở
            thành một hiện tượng mạng.
          </Text>

          <Row gap="12" marginTop="8">
            <Button variant="primary" size="l">
              ▶ Phát Ngay
            </Button>
            <Button variant="secondary" size="l">
              Chi Tiết
            </Button>
          </Row>
        </Column>
      </div>
    </div>
  );
}
