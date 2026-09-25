import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        // Entities register through TypeOrmModule.forFeature() in feature modules.
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
